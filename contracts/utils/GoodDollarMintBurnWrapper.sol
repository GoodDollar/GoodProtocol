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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./DAOUpgradeableContract.sol";

library TokenOperation {
	using Address for address;

	function safeMint(
		address token,
		address to,
		uint256 value
	) internal {
		// mint(address,uint256)
		_callOptionalReturn(token, abi.encodeWithSelector(0x40c10f19, to, value));
	}

	function safeBurnAny(
		address token,
		address from,
		uint256 value
	) internal {
		// burn(address,uint256)
		_callOptionalReturn(token, abi.encodeWithSelector(0x9dc29fac, from, value));
	}

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
/// 1. wrap token which does not support interface `IBridge` or `IRouter`
/// 2. wrap token which wants to support multiple minters
/// 3. add security enhancement (mint cap, pausable, etc.)
contract GoodDollarMintBurnWrapper is
	IRouter,
	AccessControlEnumerableUpgradeable,
	PausableControl,
	DAOUpgradeableContract
{
	using SafeERC20 for IERC20;

	// access control roles
	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
	bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
	bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");
	bytes32 public constant REWARDS_ROLE = keccak256("REWARDS_ROLE");

	// pausable control roles
	bytes32 public constant PAUSE_MINT_ROLE = keccak256("PAUSE_MINT_ROLE");
	bytes32 public constant PAUSE_BURN_ROLE = keccak256("PAUSE_BURN_ROLE");
	bytes32 public constant PAUSE_ROUTER_ROLE = keccak256("PAUSE_ROUTER_ROLE");
	bytes32 public constant PAUSE_REWARDS_ROLE = keccak256("PAUSE_REWARDS_ROLE");

	struct Supply {
		uint256 max; // single limit of each mint
		uint256 cap; // total limit of all mint
		uint256 total; // total minted minus burned
		uint128 dailyCap; //cap per day
		uint128 mintedToday; //total minted today
		uint128 lastUpdate; //last update of dailyCap
		uint128 mintDebt;
		uint32 bpsPerDay; //basis points relative to token supply daily limit
	}

	mapping(address => Supply) public minterSupply;
	uint256 public totalMintCap; // total mint cap
	uint256 public totalMinted; // total minted amount

	enum TokenType {
		MintBurnAny, // mint and burn(address from, uint256 amount), don't need approve
		MintBurnFrom, // mint and burnFrom(address from, uint256 amount), need approve
		MintBurnSelf, // mint and burn(uint256 amount), call transferFrom first, need approve
		Transfer, // transfer and transferFrom, need approve
		TransferDeposit // transfer and transferFrom, deposit and withdraw, need approve
	}

	address public token; // the target token this contract is wrapping
	TokenType public tokenType;

	uint128 currentDay; //used to reset daily minter limit
	uint128 updateFrequency; //how often to update the relative to supply daily limit

	event SendOrMint(address to, uint256 amount, uint256 sent, uint256 minted);

	function initialize(
		TokenType _tokenType,
		uint256 _totalMintCap,
		address _admin,
		INameService _nameService
	) external initializer {
		__AccessControlEnumerable_init();
		setDAO(_nameService);
		require(_admin != address(0), "zero admin address");
		token = address(nativeToken());
		tokenType = _tokenType;
		totalMintCap = _totalMintCap;
		updateFrequency = 90 days;
		_setupRole(DEFAULT_ADMIN_ROLE, _admin);
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
	}

	function upgrade1() external {
		if (updateFrequency == 0) {
			updateFrequency = 90 days;
		}
	}

	function upgrade2() external {
		IGoodDollar(token).renounceMinter(); //moving to mint via Controller
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

	function setUpdateFrequency(uint128 inSeconds)
		external
		onlyRole(DEFAULT_ADMIN_ROLE)
	{
		updateFrequency = inSeconds;
	}

	function owner() external view returns (address) {
		return getRoleMember(DEFAULT_ADMIN_ROLE, 0);
	}

	function pause(bytes32 role) external onlyRole(DEFAULT_ADMIN_ROLE) {
		_pause(role);
	}

	function unpause(bytes32 role) external onlyRole(DEFAULT_ADMIN_ROLE) {
		_unpause(role);
	}

	function _updateCurrentDay() internal {
		currentDay = uint128(block.timestamp / 1 days);
	}

	function _mint(address to, uint256 amount)
		internal
		whenNotPaused(PAUSE_MINT_ROLE)
	{
		require(to != address(this), "forbid mint to address(this)");

		Supply storage s = minterSupply[msg.sender];
		require(s.max == 0 || amount <= s.max, "minter max exceeded");
		s.total += amount;
		require(s.total == 0 || s.total <= s.cap, "minter cap exceeded");

		totalMinted += amount;
		require(totalMinted <= totalMintCap, "total mint cap exceeded");

		bool ok = dao.mintTokens(amount, to, avatar);
		require(ok, "mint failed");
	}

	function _burn(address from, uint256 amount)
		internal
		whenNotPaused(PAUSE_BURN_ROLE)
	{
		//update stats correctly, but dont fail if it tries to transfer tokens minted elsewhere as long as we burn some
		if (totalMinted >= amount) {
			totalMinted -= amount;
		} else {
			totalMinted = 0;
		}

		if (hasRole(MINTER_ROLE, msg.sender)) {
			Supply storage s = minterSupply[msg.sender];

			if (s.total >= amount) {
				s.total -= amount;
			} else {
				s.total = 0;
			}
		}

		//handle onTokenTransfer (ERC677), assume tokens has been transfered
		if (from == address(this)) {
			TokenOperation.safeBurnSelf(token, amount);
		} else if (
			tokenType == TokenType.Transfer || tokenType == TokenType.TransferDeposit
		) {
			IERC20(token).safeTransferFrom(from, address(this), amount);
		} else if (tokenType == TokenType.MintBurnAny) {
			TokenOperation.safeBurnAny(token, from, amount);
		} else if (tokenType == TokenType.MintBurnFrom) {
			TokenOperation.safeBurnFrom(token, from, amount);
		} else if (tokenType == TokenType.MintBurnSelf) {
			IERC20(token).safeTransferFrom(from, address(this), amount);
			TokenOperation.safeBurnSelf(token, amount);
		}
	}

	// impl IRouter `mint`
	function mint(address to, uint256 amount)
		external
		onlyRole(MINTER_ROLE)
		returns (bool)
	{
		_mint(to, amount);
		return true;
	}

	// impl IRouter `burn`
	function burn(address from, uint256 amount)
		external
		onlyRole(MINTER_ROLE)
		onlyRole(ROUTER_ROLE)
		whenNotPaused(PAUSE_ROUTER_ROLE)
		returns (bool)
	{
		_burn(from, amount);
		return true;
	}

	//impl swapout for erc677
	function onTokenTransfer(
		address sender,
		uint256 amount,
		bytes memory data
	) external returns (bool) {
		require(msg.sender == token); //verify this was called from a token transfer
		(address bindaddr, uint256 chainId) = abi.decode(data, (address, uint256));
		require(chainId != 0, "zero chainId");
		bindaddr = bindaddr != address(0) ? bindaddr : sender;

		IMultichainRouter(getRoleMember(ROUTER_ROLE, 0)).anySwapOut(
			address(this),
			bindaddr,
			amount,
			chainId
		);
		return true;
	}

	function _balanceDebt(Supply storage minter) internal {
		uint256 toBurn = Math.min(
			minter.mintDebt,
			IERC20(token).balanceOf(address(this))
		);

		if (toBurn > 0) {
			minter.mintDebt -= uint128(toBurn);
			ERC20(token).burn(toBurn); //from DAOUpgradableContract -> Interfaces
		}
	}

	function _updateDailyLimitCap(Supply storage minter) internal {
		uint256 blocksPassed = block.timestamp - minter.lastUpdate;
		if (blocksPassed > updateFrequency) {
			minter.dailyCap =
				uint128(IERC20(token).totalSupply() * minter.bpsPerDay) /
				10000;
			minter.lastUpdate = uint128(block.timestamp);
		}
	}

	function sendOrMint(address to, uint256 amount)
		external
		onlyRole(REWARDS_ROLE)
		whenNotPaused(PAUSE_REWARDS_ROLE)
		returns (uint256 totalSent)
	{
		Supply storage m = minterSupply[msg.sender];
		_updateDailyLimitCap(m);

		//check if daily limit needs reset
		uint256 today = currentDay;
		_updateCurrentDay();
		if (currentDay != today) {
			m.mintedToday = 0;
		}
		uint256 maxMintToday = m.dailyCap - m.mintedToday;

		//calcualte how much to send and mint
		uint256 toSend = Math.min(IERC20(token).balanceOf(address(this)), amount);
		uint256 toMint = Math.min(amount - toSend, maxMintToday);
		totalSent = toSend + toMint;
		m.mintedToday += uint128(toMint);
		m.mintDebt += uint128(toMint);

		if (toMint > 0) _mint(to, toMint);
		else {
			//if we are not minting then we probably have positive balance, check if we can cover out debt and burn some
			//from balance in exchange for what we minted in the past ie mintDebt
			_balanceDebt(m);
		}

		if (toSend > 0) IERC20(token).safeTransfer(to, toSend);

		emit SendOrMint(to, amount, toSend, toMint);
	}

	function addMinter(
		address minter,
		uint256 cap,
		uint256 max,
		uint32 bpsPerDay,
		bool withRewardsRole
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		grantRole(MINTER_ROLE, minter);
		Supply storage m = minterSupply[minter];
		m.cap = cap;
		m.max = max;
		m.bpsPerDay = bpsPerDay;
		m.lastUpdate = uint128(block.timestamp);
		m.dailyCap = uint128(IERC20(token).totalSupply() * bpsPerDay) / 10000;
		if (withRewardsRole) {
			grantRole(REWARDS_ROLE, minter);
		} else {
			revokeRole(REWARDS_ROLE, minter);
		}
	}

	function setTotalMintCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
		totalMintCap = cap;
	}

	function setMinterTotal(
		address minter,
		uint256 total,
		bool force
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		require(force || hasRole(MINTER_ROLE, minter), "not minter");
		minterSupply[minter].total = total;
	}
}
