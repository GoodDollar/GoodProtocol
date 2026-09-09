// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../DAOStackInterfaces.sol";

interface IAdminBurnable {
	function adminBurn(address account, uint256 amount) external;

	function owner() external view returns (address);

	function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice One-shot scheme that burns illegitimate G$ from a fixed list of
 * addresses and records the USD refund owed to each of them.
 *
 * The list is fixed at construction time, so guardians can audit the exact
 * (account, G$ amount, USD refund) tuples before registering this contract as a
 * scheme with genericCall permission on the Controller. The contract has no way
 * to burn anything that is not in the list, and no way to change the list.
 *
 * Flow:
 *  1. deploy with the full list
 *  2. guardians register this address as a scheme (genericCall permission)
 *  3. anyone (or `owner`, see `execute`) calls `execute()`
 *  4. the contract unregisters itself, permanently disarming it
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
	event Executed(
		uint256 entries,
		uint256 totalGDBurned,
		uint256 totalRefundUSD
	);

	Controller public immutable controller;
	IAdminBurnable public immutable token;
	address public owner;

	/// @notice sum of all `gdAmount` in the list, checked against the actual burns
	uint256 public immutable totalGDToBurn;
	/// @notice sum of all `refundUSD` in the list
	uint256 public immutable totalRefundUSD;

	BurnEntry[] public entries;

	bool public executed;

	constructor(
		Controller _controller,
		IAdminBurnable _token,
		address _owner,
		BurnEntry[] memory _entries
	) {
		require(address(_controller) != address(0), "controller required");
		require(address(_token) != address(0), "token required");
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
			// duplicates would make the pre-flight balance check misleading
			for (uint256 j = 0; j < i; j++)
				require(_entries[j].account != e.account, "duplicate account");

			entries.push(e);
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

	/**
	 * @notice read-only pre-flight: are all listed balances still sufficient?
	 * Guardians can call this before signing the scheme registration, and it is
	 * re-checked inside `execute`.
	 */
	function canExecute()
		external
		view
		returns (bool ok, address firstShortAccount)
	{
		address avatar = controller.avatar();
		if (token.owner() != avatar) return (false, address(0));
		if (!controller.isSchemeRegistered(address(this), avatar))
			return (false, address(0));
		for (uint256 i = 0; i < entries.length; i++)
			if (token.balanceOf(entries[i].account) < entries[i].gdAmount)
				return (false, entries[i].account);

		return (!executed, address(0));
	}

	/**
	 * @notice burn the whole list in one transaction, then unregister.
	 * All or nothing: if a single burn fails, the whole transaction reverts and
	 * the scheme stays armed so it can be retried.
	 */
	function execute() external {
		require(msg.sender == owner, "not owner");
		require(!executed, "already executed");
		executed = true;

		address avatar = controller.avatar();
		// adminBurn is owner-only on the token, and the owner must be the Avatar
		// for the genericCall to be accepted
		require(token.owner() == avatar, "token owner is not the avatar");

		uint256 burned;
		uint256 len = entries.length;
		for (uint256 i = 0; i < len; i++) {
			BurnEntry memory e = entries[i];
			uint256 balanceBefore = token.balanceOf(e.account);
			require(balanceBefore >= e.gdAmount, "insufficient balance");

			(bool ok, ) = controller.genericCall(
				address(token),
				abi.encodeCall(IAdminBurnable.adminBurn, (e.account, e.gdAmount)),
				avatar,
				0
			);
			require(ok, "adminBurn failed");
			// genericCall swallows reverts of non-existent functions on some
			// proxies, so verify the balance actually moved
			require(
				token.balanceOf(e.account) == balanceBefore - e.gdAmount,
				"burn had no effect"
			);

			burned += e.gdAmount;
			emit AdminBurn(e.account, e.gdAmount, e.refundUSD);
		}

		require(burned == totalGDToBurn, "burn total mismatch");
		emit Executed(len, burned, totalRefundUSD);

		owner = address(0); // mark as run
		// prevent this contract from ever calling genericCall again
		require(controller.unregisterSelf(avatar), "unregistering failed");
	}

	/**
	 * @notice give up the permission without burning anything (abort path).
	 */
	function cancel() external {
		require(msg.sender == owner, "not owner");
		owner = address(0);
		address avatar = controller.avatar();
		if (controller.isSchemeRegistered(address(this), avatar))
			require(controller.unregisterSelf(avatar), "unregistering failed");
	}
}
