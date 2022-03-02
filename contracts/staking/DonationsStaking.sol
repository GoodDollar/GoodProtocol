// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

pragma experimental ABIEncoderV2;

import "../Interfaces.sol";
import "./SimpleStaking.sol";
import "../utils/DAOUpgradeableContract.sol";
import "./UniswapV2SwapHelper.sol";

/**
 * @title DonationStaking contract that receives funds in ETH/StakingToken
 * and stake them in the SimpleStaking contract
 */
contract DonationsStaking is DAOUpgradeableContract, IHasRouter {
	using UniswapV2SwapHelper for IHasRouter;
	SimpleStaking public stakingContract;
	ERC20 public stakingToken;
	Uniswap public uniswap;
	bool public active;
	uint256 public totalETHDonated;
	//max percentage of token/dai pool liquidity to swap to DAI when collecting interest out of 100000
	uint24 public maxLiquidityPercentageSwap;
	address[] public ethToStakingTokenSwapPath;
	address[] public stakingTokenToEthSwapPath;
	mapping(address => uint256) public totalStakingTokensDonated;
	event DonationStaked(
		address caller,
		uint256 totalStaked,
		uint256 ethDonated,
		uint256 tokenDonated
	);

	modifier isActive() {
		require(active);
		_;
	}

	receive() external payable {}

	function initialize(
		INameService _ns,
		address _stakingContract,
		address[] memory _ethToStakingTokenSwapPath,
		address[] memory _stakingTokenToEthSwapPath
	) public initializer {
		setDAO(_ns);
		uniswap = Uniswap(_ns.getAddress("UNISWAP_ROUTER"));
		stakingContract = SimpleStaking(_stakingContract);
		stakingToken = stakingContract.token();
		maxLiquidityPercentageSwap = 300; //0.3%
		stakingToken.approve(address(stakingContract), type(uint256).max); //we trust the staking contract
		stakingToken.approve(address(uniswap), type(uint256).max); // we trust uniswap router
		active = true;
		ethToStakingTokenSwapPath = _ethToStakingTokenSwapPath;
		stakingTokenToEthSwapPath = _stakingTokenToEthSwapPath;
	}

	/**
	 * @dev stake available funds. It
	 * take balance in eth and buy stakingToken from uniswap then stake outstanding StakingToken balance.
	 * anyone can call this.
	 */
	function stakeDonations() public payable isActive {
		uint256 stakingTokenDonated = stakingToken.balanceOf(address(this));
		uint256 ethDonated = _buyStakingToken();

		uint256 stakingTokenBalance = stakingToken.balanceOf(address(this));
		require(stakingTokenBalance > 0, "no stakingToken to stake");

		stakingContract.stake(stakingTokenBalance, 100, false);
		totalETHDonated += ethDonated;
		totalStakingTokensDonated[address(stakingToken)] += stakingTokenDonated;
		emit DonationStaked(
			msg.sender,
			stakingTokenBalance,
			ethDonated,
			stakingTokenDonated
		);
	}

	/**
	 * @dev total Staking Token value staked
	 * @return Staking Token value staked
	 */
	function totalStaked() public view returns (uint256) {
		(uint256 stakingAmount, ) = stakingContract.getProductivity(address(this));
		return stakingAmount;
	}

	/**
	 * @dev internal method to buy stakingToken from uniswap
	 * @return eth value converted
	 */
	function _buyStakingToken() internal returns (uint256) {
		//buy from uniwasp
		uint256 ethBalance = address(this).balance;
		if (ethBalance == 0) return 0;
		uint256 safeAmount = IHasRouter(this).maxSafeTokenAmount(
			address(0x0),
			address(stakingToken),
			ethBalance,
			maxLiquidityPercentageSwap
		);
		IHasRouter(this).swap(
			ethToStakingTokenSwapPath,
			safeAmount,
			0,
			address(this)
		);
		return ethBalance;
	}

	function setActive(bool _active) public {
		_onlyAvatar();
		active = _active;
	}

	function setMaxLiquidityPercentageSwap(uint24 _maxPercentage) public virtual {
		_onlyAvatar();
		maxLiquidityPercentageSwap = _maxPercentage;
	}

	/**
	 * @dev withdraws all stakes and then transfer all balances to avatar
	 * this can also be called by owner(Foundation) but it is safe as funds are transfered to avatar
	 * and only avatar can upgrade this contract logic
	 */
	function withdraw() public returns (uint256, uint256) {
		_onlyAvatar();
		(uint256 stakingAmount, ) = stakingContract.getProductivity(address(this));
		if (stakingAmount > 0) stakingContract.withdrawStake(stakingAmount, false);
		uint256 stakingTokenBalance = stakingToken.balanceOf(address(this));
		uint256 ethBalance = address(this).balance;
		stakingToken.transfer(avatar, stakingTokenBalance);
		address payable receiver = payable(avatar);
		receiver.transfer(ethBalance);
		return (stakingTokenBalance, ethBalance);
	}

	function getVersion() public pure returns (string memory) {
		return "2.0.0";
	}

	/**
	 * @dev Function to set staking contract and withdraw previous stakings and send it to avatar
	 */
	function setStakingContract(
		address _stakingContract,
		address[] memory _ethToStakingTokenSwapPath
	) external {
		_onlyAvatar();
		require(
			_ethToStakingTokenSwapPath.length >= 2 &&
				_ethToStakingTokenSwapPath[0] == address(0x0) &&
				_ethToStakingTokenSwapPath[_ethToStakingTokenSwapPath.length - 1] ==
				address(SimpleStaking(_stakingContract).token()),
			"Invalid Path"
		);
		(uint256 stakingAmount, ) = stakingContract.getProductivity(address(this));
		if (stakingAmount > 0) stakingContract.withdrawStake(stakingAmount, false);
		uint256 stakingTokenBalance = stakingToken.balanceOf(address(this));
		uint256 safeAmount = IHasRouter(this).maxSafeTokenAmount(
			address(stakingToken),
			address(0x0),
			stakingTokenBalance,
			maxLiquidityPercentageSwap
		);
		if (safeAmount > 0)
			IHasRouter(this).swap(
				stakingTokenToEthSwapPath,
				safeAmount,
				0,
				address(this)
			);
		uint256 remainingStakingTokenBalance = stakingToken.balanceOf(
			address(this)
		);
		if (remainingStakingTokenBalance > 0)
			stakingToken.transfer(avatar, remainingStakingTokenBalance);
		stakingContract = SimpleStaking(_stakingContract);
		stakingToken = stakingContract.token();
		stakingToken.approve(address(stakingContract), type(uint256).max); //we trust the staking contract
		stakingToken.approve(address(uniswap), type(uint256).max); // we trust uniswap router
		ethToStakingTokenSwapPath = _ethToStakingTokenSwapPath;
		address[] memory tempStakingToEthSwapPath = new address[](
			_ethToStakingTokenSwapPath.length
		);
		uint256 k = 0;
		for (uint256 i = _ethToStakingTokenSwapPath.length; i > 0; --i) {
			tempStakingToEthSwapPath[k] = _ethToStakingTokenSwapPath[i - 1];
			k += 1;
		}
		stakingTokenToEthSwapPath = tempStakingToEthSwapPath;
	}

	function getRouter() public view override returns (Uniswap) {
		return Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
	}

	/**
	 * @dev Function to set swap paths from eth to staking and staking to eth
	 */
	function setSwapPaths(address[] memory _ethToStakingTokenSwapPath)
		external
		returns (bool)
	{
		require(
			_ethToStakingTokenSwapPath.length >= 2 &&
				_ethToStakingTokenSwapPath.length >= 2 &&
				_ethToStakingTokenSwapPath[0] == address(0x0) &&
				_ethToStakingTokenSwapPath[_ethToStakingTokenSwapPath.length - 1] ==
				address(stakingToken),
			"Invalid path"
		);
		_onlyAvatar();
		address[] memory tempStakingToEthSwapPath = new address[](
			_ethToStakingTokenSwapPath.length
		);
		uint256 k = 0;
		for (uint256 i = _ethToStakingTokenSwapPath.length; i > 0; --i) {
			tempStakingToEthSwapPath[k] = _ethToStakingTokenSwapPath[i - 1];
			k += 1;
		}
		ethToStakingTokenSwapPath = _ethToStakingTokenSwapPath;
		stakingTokenToEthSwapPath = tempStakingToEthSwapPath;

		return true;
	}
}
