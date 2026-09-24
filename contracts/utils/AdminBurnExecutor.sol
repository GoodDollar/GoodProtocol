// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../DAOStackInterfaces.sol";

interface IAdminBurnable {
	function adminBurn(address account, uint256 amount) external;

	function owner() external view returns (address);

	function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice One-shot scheme that burns illegitimate G$ and records the USD refund
 * owed to each affected address.
 *
 * Two ways in:
 *  - `execute()` burns the list fixed at construction time. Guardians can audit
 *    the exact (account, G$ amount, USD refund) tuples before registering this
 *    contract as a scheme with genericCall permission on the Controller.
 *    Entries that fail are skipped, not reverted, and the permission is *kept*
 *    so `execute()` can be re-run for whatever is left over.
 *  - `burn(accounts, amounts)` burns a freely supplied list, for anything the
 *    constructor list missed or got wrong. This is the terminal operation: it
 *    always relinquishes the scheme permission when it returns.
 *
 * The USD refund amounts are *recorded only* - they are emitted per account and
 * kept readable on-chain for the off-chain compensation process. This contract
 * does not move USD or any stablecoin.
 */
contract AdminBurnExecutor {
	struct BurnEntry {
		address account;
		uint256 gdAmount; // G$ to burn, 18 decimals (SuperGoodDollar)
		uint256 refundUSD; // USD owed back to `account`, 18 decimals
	}

	event AdminBurn(address indexed account, uint256 gdAmount, uint256 refundUSD);
	event BurnFailed(address indexed account, uint256 gdAmount, string reason);
	/// @notice one `execute()` run; `complete` is false while entries remain
	event Executed(
		uint256 burnedNow,
		uint256 failedNow,
		uint256 totalGDBurned,
		bool complete
	);
	/// @notice one `burn()` run - the permission is gone once this is emitted
	event FreeBurn(uint256 burnedNow, uint256 failedNow, uint256 totalGDBurned);
	event PermissionRelinquished();

	Controller public immutable controller;
	IAdminBurnable public immutable token;
	address public owner;

	/// @notice sum of all `gdAmount` in the constructor list
	uint256 public immutable totalGDToBurn;
	/// @notice sum of all `refundUSD` in the constructor list
	uint256 public immutable totalRefundUSD;

	BurnEntry[] public entries;
	/// @notice per-entry completion, parallel to `entries`
	bool[] public entryBurned;
	/// @notice how many of the constructor entries have burned so far
	uint256 public burnedEntries;
	/// @notice G$ actually burned by this contract, across every run
	uint256 public totalGDBurned;
	/// @notice true once the scheme permission has been given up
	bool public relinquished;

	constructor(
		Controller _controller,
		IAdminBurnable _token,
		address _owner,
		BurnEntry[] memory _entries
	) {
		require(address(_controller) != address(0), "controller required");
		require(address(_token) != address(0), "token required");
		require(_owner != address(0), "owner required");
		require(_entries.length > 0, "empty burn list");

		controller = _controller;
		token = _token;
		owner = _owner;

		uint256 gd;
		uint256 usd;
		for (uint256 i = 0; i < _entries.length; i++) {
			BurnEntry memory e = _entries[i];
			require(e.account != address(0), "zero account");
			require(e.gdAmount > 0, "zero burn amount");
			// duplicates would double count against `totalGDToBurn`
			for (uint256 j = 0; j < i; j++)
				require(_entries[j].account != e.account, "duplicate account");

			entries.push(e);
			entryBurned.push(false);
			gd += e.gdAmount;
			usd += e.refundUSD;
		}
		totalGDToBurn = gd;
		totalRefundUSD = usd;
	}

	function entriesCount() external view returns (uint256) {
		return entries.length;
	}

	function getEntries() external view returns (BurnEntry[] memory) {
		return entries;
	}

	/// @notice entries from the constructor list that have not burned yet
	function pendingEntries() external view returns (BurnEntry[] memory pending) {
		uint256 n = entries.length - burnedEntries;
		pending = new BurnEntry[](n);
		uint256 k;
		for (uint256 i = 0; i < entries.length; i++)
			if (!entryBurned[i]) pending[k++] = entries[i];
	}

	/// @notice the whole constructor list has burned
	function complete() public view returns (bool) {
		return burnedEntries == entries.length;
	}

	/**
	 * @notice read-only pre-flight for `execute()`: is the scheme usable, and do
	 * the pending accounts still hold enough? `firstShortAccount` is the first
	 * pending account whose balance is short, if any.
	 */
	function canExecute()
		external
		view
		returns (bool ok, address firstShortAccount)
	{
		if (relinquished || complete()) return (false, address(0));

		address avatar = controller.avatar();
		if (token.owner() != avatar) return (false, address(0));
		if (!controller.isSchemeRegistered(address(this), avatar))
			return (false, address(0));

		for (uint256 i = 0; i < entries.length; i++)
			if (!entryBurned[i] && token.balanceOf(entries[i].account) < entries[i].gdAmount)
				return (true, entries[i].account);

		return (true, address(0));
	}

	/**
	 * @notice burn the pending part of the constructor list.
	 *
	 * Best effort per account: an entry that can not be burned right now (short
	 * balance, reverting burn) is skipped and reported through `BurnFailed`, and
	 * the scheme permission is retained so this can be called again once the
	 * cause is resolved. The permission is only given up once every entry in the
	 * list has burned.
	 */
	function execute() external returns (uint256 burnedNow, uint256 failedNow) {
		require(msg.sender == owner, "not owner");
		require(!relinquished, "permission already relinquished");
		require(!complete(), "already executed");

		address avatar = _avatarWithBurnRights();

		for (uint256 i = 0; i < entries.length; i++) {
			if (entryBurned[i]) continue;
			BurnEntry memory e = entries[i];

			if (_burn(avatar, e.account, e.gdAmount)) {
				entryBurned[i] = true;
				burnedEntries++;
				burnedNow++;
				emit AdminBurn(e.account, e.gdAmount, e.refundUSD);
			} else {
				failedNow++;
			}
		}

		bool done = complete();
		emit Executed(burnedNow, failedNow, totalGDBurned, done);

		// keep the permission while anything is still pending, so a failed entry
		// can be retried without redeploying and re-approving the scheme
		if (done) _relinquish(avatar);
	}

	/**
	 * @notice burn a freely supplied list of accounts, then give up the scheme
	 * permission unconditionally.
	 *
	 * This is the terminal operation - use it for whatever the constructor list
	 * missed. Failures are reported through `BurnFailed` rather than reverting,
	 * so a single bad account can not strand the rest of the list, and the
	 * permission is relinquished either way. Constructor entries burned here are
	 * marked off the list too.
	 */
	function burn(
		address[] calldata accounts,
		uint256[] calldata amounts
	) external returns (uint256 burnedNow, uint256 failedNow) {
		require(msg.sender == owner, "not owner");
		require(!relinquished, "permission already relinquished");
		require(accounts.length == amounts.length, "length mismatch");
		require(accounts.length > 0, "empty burn list");

		address avatar = _avatarWithBurnRights();

		for (uint256 i = 0; i < accounts.length; i++) {
			if (_burn(avatar, accounts[i], amounts[i])) {
				burnedNow++;
				_markEntry(accounts[i], amounts[i]);
				emit AdminBurn(accounts[i], amounts[i], 0);
			} else {
				failedNow++;
			}
		}

		emit FreeBurn(burnedNow, failedNow, totalGDBurned);

		// terminal by design: no second free-form burn without a new approval
		_relinquish(avatar);
	}

	/**
	 * @notice give up the permission without burning anything (abort path).
	 */
	function cancel() external {
		require(msg.sender == owner, "not owner");
		_relinquish(controller.avatar());
	}

	/**
	 * @dev one burn through the Avatar. Returns false instead of reverting so a
	 * single bad account never strands the rest of the list.
	 */
	function _burn(
		address avatar,
		address account,
		uint256 amount
	) internal returns (bool) {
		if (account == address(0)) {
			emit BurnFailed(account, amount, "zero account");
			return false;
		}
		if (amount == 0) {
			emit BurnFailed(account, amount, "zero amount");
			return false;
		}

		uint256 balanceBefore = token.balanceOf(account);
		if (balanceBefore < amount) {
			emit BurnFailed(account, amount, "insufficient balance");
			return false;
		}

		(bool ok, ) = controller.genericCall(
			address(token),
			abi.encodeCall(IAdminBurnable.adminBurn, (account, amount)),
			avatar,
			0
		);
		if (!ok) {
			emit BurnFailed(account, amount, "adminBurn reverted");
			return false;
		}
		// genericCall reports success for a call into a function the live
		// implementation does not have, so verify the balance actually moved
		if (token.balanceOf(account) != balanceBefore - amount) {
			emit BurnFailed(account, amount, "burn had no effect");
			return false;
		}

		totalGDBurned += amount;
		return true;
	}

	/// @dev mark a constructor entry off the list when `burn` covered it exactly
	function _markEntry(address account, uint256 amount) internal {
		for (uint256 i = 0; i < entries.length; i++)
			if (!entryBurned[i] && entries[i].account == account && entries[i].gdAmount == amount) {
				entryBurned[i] = true;
				burnedEntries++;
				return;
			}
	}

	function _avatarWithBurnRights() internal view returns (address avatar) {
		avatar = controller.avatar();
		// adminBurn is owner-only on the token, and the owner must be the Avatar
		// for the genericCall to be accepted
		require(token.owner() == avatar, "token owner is not the avatar");
		require(
			controller.isSchemeRegistered(address(this), avatar),
			"not a registered scheme"
		);
	}

	/// @dev drop the genericCall permission for good
	function _relinquish(address avatar) internal {
		relinquished = true;
		owner = address(0);
		if (controller.isSchemeRegistered(address(this), avatar))
			require(controller.unregisterSelf(avatar), "unregistering failed");
		emit PermissionRelinquished();
	}
}
