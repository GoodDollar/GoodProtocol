// SPDX-License-Identifier: MIT
/**
 Wrap the G$ token to provide mint permissions to multichain.org router/bridge
 based on https://github.com/anyswap/multichain-smart-contracts/blob/1459fe6281867319af8ffb1849e5c16d242d6530/contracts/wrapper/MintBurnWrapper.sol

 Added onTokenTransfer
 Notice: contract needs to be registered as a scheme on Controller to be able to call mintTokens
 Fixed:
 https://github.com/anyswap/multichain-smart-contracts/issues/4
 https://github.com/anyswap/multichain-smart-contracts/issues/3
 */

pragma solidity ^0.8;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
// import "hardhat/console.sol";

import "./DAOUpgradeableContract.sol";

library TokenOperation {
	using AddressUpgradeable for address;

	function safeBurnSelf(address token, uint256 value) internal {
		// burn(uint256)
		_callOptionalReturn(token, abi.encodeWithSelector(0x42966c68, value));
	}

	function safeBurnFrom(
		address token,
		address from,
		uint256 value
	) internal {
		// burnFrom(address,uint256)
		_callOptionalReturn(token, abi.encodeWithSelector(0x79cc6790, from, value));
	}

	function _callOptionalReturn(address token, bytes memory data) private {
		bytes memory returndata = token.functionCall(
			data,
			"TokenOperation: low-level call failed"
		);
		if (returndata.length > 0) {
			// Return data is optional
			require(
				abi.decode(returndata, (bool)),
				"TokenOperation: did not succeed"
			);
		}
	}
}

interface IRouter {
	function mint(address to, uint256 amount) external returns (bool);

	function burn(address from, uint256 amount) external returns (bool);
}

//License-Identifier: GPL-3.0-or-later

abstract contract PausableControl {
	mapping(bytes32 => bool) private _pausedRoles;

	bytes32 public constant PAUSE_ALL_ROLE = 0x00;

	event Paused(bytes32 role);
	event Unpaused(bytes32 role);

	modifier whenNotPaused(bytes32 role) {
		require(
			!paused(role) && !paused(PAUSE_ALL_ROLE),
			"PausableControl: paused"
		);
		_;
	}

	modifier whenPaused(bytes32 role) {
		require(
			paused(role) || paused(PAUSE_ALL_ROLE),
			"PausableControl: not paused"
		);
		_;
	}

	function paused(bytes32 role) public view virtual returns (bool) {
		return _pausedRoles[role];
	}

	function _pause(bytes32 role) internal virtual whenNotPaused(role) {
		_pausedRoles[role] = true;
		emit Paused(role);
	}

	function _unpause(bytes32 role) internal virtual whenPaused(role) {
		_pausedRoles[role] = false;
		emit Unpaused(role);
	}
}

/// @dev MintBurnWrapper has the following aims:
/// 1. wrap token which does not support interface `IRouter`
/// 2. wrap token which wants to support multiple minters
/// 3. add security enhancement (mint cap, pausable, etc.)
contract GoodDollarMintBurnWrapper is
	IRouter,
	AccessControlEnumerableUpgradeable,
	PausableControl,
	DAOUpgradeableContract
{
	using SafeERC20Upgradeable for IERC20Upgradeable;

	// access control roles
	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
	bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
	bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");
	bytes32 public constant REWARDS_ROLE = keccak256("REWARDS_ROLE");
	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

	// pausable control roles
	bytes32 public constant PAUSE_MINT_ROLE = keccak256("PAUSE_MINT_ROLE");
	bytes32 public constant PAUSE_BURN_ROLE = keccak256("PAUSE_BURN_ROLE");
	bytes32 public constant PAUSE_ROUTER_ROLE = keccak256("PAUSE_ROUTER_ROLE");
	bytes32 public constant PAUSE_REWARDS_ROLE = keccak256("PAUSE_REWARDS_ROLE");

	struct InLimits {
		uint256 maxIn; // single limit of each mint
		uint256 capIn; // total limit of all mint
		uint256 totalIn; // total minted minus burned
		uint128 dailyCapIn; //cap per day (rewards sendOrMint only)
		uint128 mintedToday; //total minted today
		uint128 lastUpdate; //last update of dailyCap
		uint128 totalRewards; // total rewards sent (sent + minted) (rewards sendOrMint only)
		uint32 bpsPerDayIn; //basis points relative to token supply daily limit (rewards sendOrMint only)
		uint128 lastDayReset; //last day we reset the daily limits
	}

	struct OutLimits {
		uint256 maxOut; // single limit of each burn
		uint256 capOut; // total limit of all burn
		uint256 totalOut; // total burned minus minted
		uint128 dailyCapOut; //burn cap per day
		uint128 burnedToday; //total burned today
		uint32 bpsPerDayOut; //basis points relative to token supply daily limit
	}

	mapping(address => InLimits) public minterSupply;
	uint256 public totalMintCap_unused; // total mint cap, not used, kept because of upgradable storage
	uint256 public totalMinted; // total minted amount

	address public token; // the target token this contract is wrapping
	uint256 private unused_tokenType; //kept because of upgradable storage layout, contract already deployed to Celo contains it

	uint128 public currentDay; //used to reset daily minter limit
	uint128 public updateFrequency; //how often to update the relative to supply daily limit
	uint128 public totalMintDebt; // total outstanding rewards mint debt
	uint128 public totalRewards; // total rewards sent (sent + minted)
	mapping(address => OutLimits) public minterOutLimits;

	event Minted(address minter, address to, uint256 amount);
	event Burned(address minter, address to, uint256 amount);
	event SendOrMint(
		address rewarder,
		address to,
		uint256 amount,
		uint256 sent,
		uint256 minted,
		uint256 outstandingMintDebt
	);
	event MinterSet(
		address minter,
		uint256 totalMintCapIn,
		uint256 perTxCapIn,
		uint32 bpsIn,
		uint256 totalMintCapOut,
		uint256 perTxCapOut,
		uint32 bpsOut,
		bool rewardsRole,
		bool isUpdate
	);

	event UpdateFrequencySet(uint128 newFrequency);

	modifier onlyRoles(bytes32[2] memory roles) {
		require(
			hasRole(roles[0], _msgSender()) || hasRole(roles[1], _msgSender()),
			"role missing"
		);
		_;
	}

	function initialize(address _admin, INameService _nameService)
		external
		initializer
	{
		__AccessControlEnumerable_init();
		setDAO(_nameService);
		require(_admin != address(0), "zero admin address");
		token = address(nativeToken());
		updateFrequency = 7 days;
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		_setupRole(DEFAULT_ADMIN_ROLE, _admin);
	}

	function decimals() external view returns (uint8) {
		return ERC20(token).decimals();
	}

	function name() external view returns (string memory) {
		return ERC20(token).name();
	}

	function symbol() external view returns (string memory) {
		return ERC20(token).symbol();
	}

	function balanceOf(address account) external view returns (uint256 balance) {
		return ERC20(token).balanceOf(account);
	}

	function owner() external view returns (address) {
		return getRoleMember(DEFAULT_ADMIN_ROLE, 0);
	}

	/**
	 @notice set how frequent to udpate rewarder daily limit based on bps out of total supply
	 @param inSeconds frequency in seconds
	 */
	function setUpdateFrequency(uint128 inSeconds)
		external
		onlyRoles([GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE])
	{
		updateFrequency = inSeconds;
		emit UpdateFrequencySet(inSeconds);
	}

	/**
	 * @notice pause one of the functions of the wrapper (see pause roles), only dev/guardian roles can call this
	 * @param role which function to pause
	 */
	function pause(bytes32 role)
		external
		onlyRoles([GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE])
	{
		_pause(role);
	}

	/**
	 * @notice unpause one of the functions of the wrapper (see pause roles), only dev/guardian roles can call this
	 * @param role which function to unpause
	 */
	function unpause(bytes32 role)
		external
		onlyRoles([GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE])
	{
		_unpause(role);
	}

	/**
	 * @notice implement the IRouter mint required for work with multichain router. This method is used by the multichain bridge to mint new tokens on sidechain
	 * on bridge transfer from another chain. Can only be called by the ROUTER role
	 * @param to recipient
	 * @param amount amount to mint
	 */
	function mint(address to, uint256 amount)
		external
		onlyRole(MINTER_ROLE)
		returns (bool)
	{
		_updateDailyLimitCap(msg.sender);
		_mint(to, amount);
		emit Minted(msg.sender, to, amount);
		return true;
	}

	/**
	 * @notice implement the IRouter burn required for work with multichain router. This method is used by the multichain bridge to burn tokens on sidechain
	 * on bridge transfer to other chain. Can only be called by the ROUTER role
	 * @param from sender - requires sender to first approve tokens to the wrapper or use transferAndCall
	 * @param amount amount to mint
	 */
	function burn(address from, uint256 amount)
		external
		onlyRole(MINTER_ROLE)
		whenNotPaused(PAUSE_ROUTER_ROLE)
		returns (bool)
	{
		_updateDailyLimitCap(msg.sender);
		_burn(from, amount);
		emit Burned(msg.sender, from, amount);
		return true;
	}

	/**
	 * @notice helper function to transfer from sidechain to another chain without the need to first approve tokens for burn.
	 * sender call transferAndCall(wrapperAddress,abi.encode(recipient,target chain id))
	 * @param sender sender
	 * @param amount sent by sender
	 * @param data expected to be recipient + target chain abi encoded
	 */
	function onTokenTransfer(
		address sender,
		uint256 amount,
		bytes memory data
	) external returns (bool) {
		require(msg.sender == token); //verify this was called from a token transfer
		(address bindaddr, uint256 chainId) = abi.decode(data, (address, uint256));
		require(chainId != 0, "zero chainId");
		bindaddr = bindaddr != address(0) ? bindaddr : sender;

		IMultichainRouter(nameService.getAddress("MULTICHAIN_ROUTER")).anySwapOut(
			address(this),
			bindaddr,
			amount,
			chainId
		);
		return true;
	}

	/**
	 * @notice allow REWARDS_ROLE to send existing funds in balance or mint new G$ on sidechain to recipient.
	 * @param to recipient
	 * @param amount amount to send or mint. if not enough balance the rest will be minted up to the rewarder dailyLimit
	 */
	function sendOrMint(address to, uint256 amount)
		external
		onlyRole(REWARDS_ROLE)
		whenNotPaused(PAUSE_REWARDS_ROLE)
		returns (uint256 totalSent)
	{
		_updateDailyLimitCap(msg.sender);

		uint256 maxMintToday = minterSupply[msg.sender].dailyCapIn == 0
			? amount
			: minterSupply[msg.sender].dailyCapIn -
				minterSupply[msg.sender].mintedToday;

		//calcualte how much to send and mint
		uint256 toSend = Math.min(
			IERC20Upgradeable(token).balanceOf(address(this)),
			amount
		);
		uint256 toMint = Math.min(amount - toSend, maxMintToday);
		// console.log("sendOrMint %s %s %s", toMint, toSend, maxMintToday);
		totalSent = toSend + toMint;
		minterSupply[msg.sender].totalRewards += uint128(totalSent);
		totalRewards += uint128(totalSent);
		totalMintDebt += uint128(toMint);
		if (toMint > 0) _mint(to, toMint);

		if (toSend > 0) {
			IERC20Upgradeable(token).safeTransfer(to, toSend);
		}

		if (toMint == 0) {
			//if we are not minting then we might have positive balance, check if we can cover out debt and burn some
			//from balance in exchange for what we minted in the past ie mintDebt
			_balanceDebt();
		}

		emit SendOrMint(_msgSender(), to, amount, toSend, toMint, totalMintDebt);
	}

	/**
	 * @notice add minter or rewards role
	 * @param minter address of minter
	 * @param globalLimitIn minter global limit
	 * @param perTxLimitIn minter per tx limit
	 * @param bpsPerDayIn limit for rewards role in bps relative to G$ total supply
	 * @param globalLimitOut minter global limit
	 * @param perTxLimitOut minter per tx limit
	 * @param bpsPerDayOut limit for rewards role in bps relative to G$ total supply
	 * @param withRewardsRole should also grant REWARDS_ROLE to minter
	 */
	function addMinter(
		address minter,
		uint256 globalLimitIn,
		uint256 perTxLimitIn,
		uint32 bpsPerDayIn,
		uint256 globalLimitOut,
		uint256 perTxLimitOut,
		uint32 bpsPerDayOut,
		bool withRewardsRole
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		if (withRewardsRole) {
			grantRole(REWARDS_ROLE, minter);
			revokeRole(MINTER_ROLE, minter);
		} else {
			grantRole(MINTER_ROLE, minter);
			revokeRole(REWARDS_ROLE, minter);
		}
		_setMinterCaps(
			minter,
			globalLimitIn,
			perTxLimitIn,
			bpsPerDayIn,
			globalLimitOut,
			perTxLimitOut,
			bpsPerDayOut
		);
	}

	/**
	 * @notice update minter or rewards role limits
	 * @param minter address of minter
	 * @param globalLimitIn minter global limit
	 * @param perTxLimitIn minter per tx limit
	 * @param bpsPerDayIn limit for rewards role in bps relative to G$ total supply
	 * @param globalLimitOut minter global limit
	 * @param perTxLimitOut minter per tx limit
	 * @param bpsPerDayOut limit for rewards role in bps relative to G$ total supply
	 */
	function setMinterCaps(
		address minter,
		uint256 globalLimitIn,
		uint256 perTxLimitIn,
		uint32 bpsPerDayIn,
		uint256 globalLimitOut,
		uint256 perTxLimitOut,
		uint32 bpsPerDayOut
	) external onlyRoles([GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE]) {
		_setMinterCaps(
			minter,
			globalLimitIn,
			perTxLimitIn,
			bpsPerDayIn,
			globalLimitOut,
			perTxLimitOut,
			bpsPerDayOut
		);
	}

	/**
	 * @notice update minter or rewards role limits
	 * @param minter address of minter
	 * @param globalLimitIn minter global limit
	 * @param perTxLimitIn minter per tx limit
	 * @param bpsPerDayIn limit for rewards role in bps relative to G$ total supply
	 * @param globalLimitOut minter global limit
	 * @param perTxLimitOut minter per tx limit
	 * @param bpsPerDayOut limit for rewards role in bps relative to G$ total supply
	 */
	function _setMinterCaps(
		address minter,
		uint256 globalLimitIn,
		uint256 perTxLimitIn,
		uint32 bpsPerDayIn,
		uint256 globalLimitOut,
		uint256 perTxLimitOut,
		uint32 bpsPerDayOut
	) internal {
		InLimits storage m = minterSupply[minter];
		OutLimits storage o = minterOutLimits[minter];
		bool isUpdate = m.lastUpdate > 0;
		bool withRewardsRole = hasRole(REWARDS_ROLE, minter);
		m.capIn = globalLimitIn;
		m.maxIn = perTxLimitIn;
		m.bpsPerDayIn = bpsPerDayIn;
		m.lastUpdate = uint128(block.timestamp);
		m.dailyCapIn =
			uint128(IERC20Upgradeable(token).totalSupply() * bpsPerDayIn) /
			10000;
		o.dailyCapOut =
			uint128(IERC20Upgradeable(token).totalSupply() * bpsPerDayOut) /
			10000;
		o.capOut = globalLimitOut;
		o.maxOut = perTxLimitOut;
		o.bpsPerDayOut = bpsPerDayOut;

		emit MinterSet(
			minter,
			globalLimitIn,
			perTxLimitIn,
			bpsPerDayIn,
			globalLimitOut,
			perTxLimitOut,
			bpsPerDayOut,
			withRewardsRole,
			isUpdate
		);
	}

	/**
	 * @notice helper to update the current day, used to reset rewards role daily limit
	 */
	function _updateCurrentDay() internal {
		currentDay = uint128(block.timestamp / 1 days);
	}

	/**
	 * @notice helper for mint/sendOrMint action
	 */
	function _mint(address to, uint256 amount)
		internal
		whenNotPaused(PAUSE_MINT_ROLE)
	{
		require(to != address(this), "mint to self");

		require(
			minterSupply[msg.sender].maxIn == 0 ||
				amount <= minterSupply[msg.sender].maxIn,
			"minter max exceeded"
		);
		require(
			minterSupply[msg.sender].dailyCapIn == 0 ||
				minterSupply[msg.sender].dailyCapIn >=
				(minterSupply[msg.sender].mintedToday + amount),
			"minter daily cap exceeded"
		);

		minterSupply[msg.sender].mintedToday += uint128(amount);
		minterSupply[msg.sender].totalIn += amount;
		require(
			minterSupply[msg.sender].capIn == 0 ||
				minterSupply[msg.sender].totalIn <= minterSupply[msg.sender].capIn,
			"minter cap exceeded"
		);

		totalMinted += amount;

		if (minterOutLimits[msg.sender].totalOut >= amount) {
			minterOutLimits[msg.sender].totalOut -= amount;
		} else {
			minterOutLimits[msg.sender].totalOut = 0;
		}

		bool ok = dao.mintTokens(amount, to, avatar);
		require(ok, "mint failed");
	}

	/**
	 * @notice helper for burn action
	 */
	function _burn(address from, uint256 amount)
		internal
		whenNotPaused(PAUSE_BURN_ROLE)
	{
		require(
			minterOutLimits[msg.sender].maxOut == 0 ||
				amount <= minterOutLimits[msg.sender].maxOut,
			"minter burn max exceeded"
		);
		require(
			minterOutLimits[msg.sender].dailyCapOut == 0 ||
				minterOutLimits[msg.sender].dailyCapOut >=
				(minterOutLimits[msg.sender].burnedToday + amount),
			"minter burn daily cap exceeded"
		);

		minterOutLimits[msg.sender].burnedToday += uint128(amount);
		minterOutLimits[msg.sender].totalOut += amount;
		require(
			minterOutLimits[msg.sender].capOut == 0 ||
				minterOutLimits[msg.sender].totalOut <=
				minterOutLimits[msg.sender].capOut,
			"minter cap exceeded"
		);

		//update stats correctly, but dont fail if it tries to transfer tokens minted elsewhere as long as we burn some
		if (totalMinted >= amount) {
			totalMinted -= amount;
		} else {
			totalMinted = 0;
		}

		if (minterSupply[msg.sender].totalIn >= amount) {
			minterSupply[msg.sender].totalIn -= amount;
		} else {
			minterSupply[msg.sender].totalIn = 0;
		}

		//handle onTokenTransfer (ERC677), assume tokens has been transfered
		if (from == address(this)) {
			TokenOperation.safeBurnSelf(token, amount);
		} else {
			TokenOperation.safeBurnFrom(token, from, amount);
		}
	}

	/**
	 * @notice helper for sendOrMint action to burn from balance to cover minting debt
	 */
	function _balanceDebt() internal {
		uint256 toBurn = Math.min(
			totalMintDebt,
			IERC20Upgradeable(token).balanceOf(address(this))
		);

		if (toBurn > 0) {
			totalMintDebt -= uint128(toBurn);
			totalMinted -= toBurn;
			ERC20(token).burn(toBurn); //from DAOUpgradableContract -> Interfaces
		}
	}

	/**
	 * @notice helper for sendOrMint action to update the rewarder daily limit if updateFrequency passed
	 */
	function _updateDailyLimitCap(address minter) internal {
		uint256 secondsPassed = block.timestamp - minterSupply[minter].lastUpdate;
		uint256 totalSupply = IERC20Upgradeable(token).totalSupply();
		if (secondsPassed >= updateFrequency) {
			minterSupply[minter].dailyCapIn = uint128(
				(totalSupply * minterSupply[minter].bpsPerDayIn) / 10000
			);
			minterOutLimits[minter].dailyCapOut = uint128(
				(totalSupply * minterOutLimits[minter].bpsPerDayOut) / 10000
			);
			minterSupply[minter].lastUpdate = uint128(block.timestamp);
			// console.log(
			// 	"secondsPassed %s %s %s",
			// 	secondsPassed,
			// 	minter.dailyCap,
			// 	minter.lastUpdate
			// );
		}

		//check if daily limit needs reset
		_updateCurrentDay();
		if (currentDay != minterSupply[minter].lastDayReset) {
			minterSupply[minter].mintedToday = 0;
			minterOutLimits[minter].burnedToday = 0;
			minterSupply[minter].lastDayReset = currentDay;
		}
	}
}
