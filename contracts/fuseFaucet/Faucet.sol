//SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../Interfaces.sol";
import "../utils/NameService.sol";

/**
 * @title FuseFaucet contract that can top up users wallets
 */
contract Faucet is Initializable, UUPSUpgradeable, AccessControlUpgradeable {
	bytes32 public constant RELAYER_ROLE = keccak256("relayer");

	event WalletTopped(
		address indexed account, //address topped
		uint256 amount,
		address whitelistedRoot, //if account is connected to a whitelisted account, this will be it
		address indexed relayerOrWhitelisted //the sender of the tx
	);

	uint256 public perDayRoughLimit;
	uint256 public gasTopping;
	uint256 public gasRefund;
	uint256 public startTime;
	uint256 public currentDay;

	NameService public nameService;

	mapping(uint256 => mapping(address => uint256)) public toppings;
	mapping(address => bool) public notFirstTime;

	struct Wallet {
		uint128 lastDayTopped;
		uint32 dailyToppingCount;
		uint128[7] lastWeekToppings;
	}

	mapping(address => Wallet) public wallets;
	uint32 public maxDailyToppings;
	uint64 public gasPrice;
	uint32 public maxPerWeekMultiplier;
	uint32 public maxSwapAmount;
	address public goodDollar_unused; //kept because of upgrades
	uint64 public maxDailyNewWallets;
	uint64 public dailyNewWalletsCount;
	uint32 public version;

	function initialize(
		NameService _ns,
		uint64 _gasPrice,
		address relayer,
		address owner
	) public initializer {
		__AccessControl_init_unchained();
		_setupRole(DEFAULT_ADMIN_ROLE, owner);
		if (relayer != address(0)) _setupRole(RELAYER_ROLE, relayer);
		gasPrice = _gasPrice;
		gasTopping = 1000000; //1m gwei
		perDayRoughLimit = 2 * gasTopping;
		maxDailyToppings = 3;
		startTime = block.timestamp;
		nameService = _ns;
		maxPerWeekMultiplier = 2;
		maxSwapAmount = 1000;
		maxDailyNewWallets = 5000;
	}

	function _authorizeUpgrade(address newImplementation)
		internal
		override
		onlyRole(DEFAULT_ADMIN_ROLE)
	{}

	function getIdentity() public view returns (IIdentityV2) {
		return IIdentityV2(nameService.getAddress("IDENTITY"));
	}

	function upgrade() public {
		require(version == 0, "already upgraded");
		if (maxDailyNewWallets == 0) maxDailyNewWallets = 5000;
		version++;
		setGasTopping(gasTopping / gasPrice);
	}

	modifier reimburseGas() {
		uint256 _gasRefund = gasleft();
		_;
		_gasRefund = _gasRefund - gasleft() + 42000;
		payable(msg.sender).transfer(_gasRefund * gasPrice); //gas price assumed 1e9 = 1gwei
	}

	receive() external payable {}

	/*
	 * only whitelisted account or relayer can top non whitelisted accounts
	 * if target account is whitelisted anyone can top it
	 */
	modifier onlyAuthorized(address toTop) {
		require(
			getIdentity().getWhitelistedRoot(toTop) != address(0) ||
				getIdentity().getWhitelistedRoot(msg.sender) != address(0) ||
				hasRole(RELAYER_ROLE, msg.sender),
			"not authorized"
		);
		_;
	}

	modifier toppingLimit(address _user) {
		//switch wallet to the account we do the accounting for
		address whitelistedRoot = getIdentity().getWhitelistedRoot(_user);
		_user = whitelistedRoot == address(0) ? _user : payable(whitelistedRoot);

		uint256 prevDay = currentDay;

		setDay();
		if (currentDay != prevDay) dailyNewWalletsCount = 0;

		require(
			wallets[_user].lastDayTopped != uint128(currentDay) ||
				wallets[_user].dailyToppingCount < maxDailyToppings,
			"max daily toppings"
		);

		require(
			(notFirstTime[_user] == false &&
				dailyNewWalletsCount < maxDailyNewWallets) ||
				whitelistedRoot != address(0),
			"User not whitelisted or not first time"
		);

		//reset inactive days
		uint256 dayOfWeek = currentDay % 7;
		uint256 dayDiff = (currentDay - wallets[_user].lastDayTopped);
		dayDiff = dayDiff > 7 ? 7 : dayDiff;
		dayDiff = dayDiff > dayOfWeek ? dayOfWeek + 1 : dayDiff;
		for (uint256 day = dayOfWeek + 1 - dayDiff; day <= dayOfWeek; day++) {
			wallets[_user].lastWeekToppings[day] = 0;
		}

		uint128 weekTotal = 0;
		for (uint256 i = 0; i <= dayOfWeek; i++) {
			weekTotal += wallets[_user].lastWeekToppings[uint256(i)];
		}

		require(
			weekTotal < perDayRoughLimit * gasPrice * maxPerWeekMultiplier,
			"User wallet has been topped too many times this week"
		);
		_;
	}

	/* @dev Internal function that sets current day
	 */
	function setDay() internal {
		currentDay = (block.timestamp - startTime) / 1 days;
	}

	function canTop(address _user) external view returns (bool) {
		if (getToppingAmount() < address(_user).balance) return false;

		address whitelistedRoot = getIdentity().getWhitelistedRoot(_user);
		_user = whitelistedRoot == address(0) ? _user : whitelistedRoot;

		uint256 _currentDay = (block.timestamp - startTime) / 1 days;
		bool can = (wallets[_user].lastDayTopped != uint128(_currentDay) ||
			wallets[_user].dailyToppingCount < 3) &&
			((notFirstTime[_user] == false &&
				dailyNewWalletsCount < maxDailyNewWallets) ||
				whitelistedRoot != address(0));

		uint128[7] memory lastWeekToppings = wallets[_user].lastWeekToppings;
		//reset inactive days
		uint256 dayOfWeek = _currentDay % 7;
		uint256 dayDiff = (_currentDay - wallets[_user].lastDayTopped);
		dayDiff = dayDiff > 7 ? 7 : dayDiff;
		dayDiff = dayDiff > dayOfWeek ? dayOfWeek + 1 : dayDiff;

		for (uint256 day = dayOfWeek + 1 - dayDiff; day <= dayOfWeek; day++) {
			lastWeekToppings[day] = 0;
		}

		uint128 weekTotal = 0;
		for (uint256 i = 0; i <= dayOfWeek; i++) {
			weekTotal += lastWeekToppings[uint256(i)];
		}
		can = can && weekTotal < perDayRoughLimit * gasPrice * maxPerWeekMultiplier;
		return can;
	}

	/* @dev Function to top given address with amount of G$ given in constructor
	 * can only be done by admin the amount of times specified in constructor per day
	 * @param _user The address to transfer to
	 */
	function topWallet(address payable _user)
		public
		reimburseGas
		toppingLimit(_user)
		onlyAuthorized(_user)
	{
		_topWallet(_user);
	}

	function _topWallet(address payable _wallet) internal {
		address payable target = _wallet;

		//switch wallet to the account we do the accounting for
		address whitelistedRoot = getIdentity().getWhitelistedRoot(_wallet);
		_wallet = whitelistedRoot == address(0)
			? _wallet
			: payable(whitelistedRoot);

		require(getToppingAmount() > address(_wallet).balance);
		uint256 toTop = getToppingAmount() - address(_wallet).balance;

		uint256 dayOfWeek = currentDay % 7;

		if (wallets[_wallet].lastDayTopped == uint128(currentDay))
			wallets[_wallet].dailyToppingCount += 1;
		else wallets[_wallet].dailyToppingCount = 1;
		wallets[_wallet].lastDayTopped = uint128(currentDay);
		wallets[_wallet].lastWeekToppings[dayOfWeek] += uint128(toTop);

		if (notFirstTime[_wallet] == false && whitelistedRoot == address(0)) {
			dailyNewWalletsCount++;
		}
		notFirstTime[_wallet] = true;

		target.transfer(toTop);
		emit WalletTopped(target, toTop, whitelistedRoot, msg.sender);
	}

	function onTokenTransfer(
		address payable _from,
		uint256 amount,
		bytes calldata data
	) external returns (bool) {
		require(amount <= maxSwapAmount, "slippage");
		address uniswapLike = abi.decode(data, (address));
		Uniswap uniswap = Uniswap(uniswapLike);
		address[] memory path = new address[](2);
		path[0] = address(msg.sender);
		path[1] = uniswap.WETH();

		cERC20(msg.sender).approve(address(uniswapLike), type(uint256).max);
		uniswap.swapExactTokensForETH(amount, 0, path, _from, block.timestamp);
		return true;
	}

	function getToppingAmount() public view returns (uint256) {
		return gasTopping * gasPrice;
	}

	function setGasTopping(uint256 _gasUnits)
		public
		onlyRole(DEFAULT_ADMIN_ROLE)
	{
		gasTopping = _gasUnits;
		perDayRoughLimit = 2 * gasTopping;
	}

	function setGasPrice(uint64 _price) external onlyRole(DEFAULT_ADMIN_ROLE) {
		gasPrice = _price;
	}
}
