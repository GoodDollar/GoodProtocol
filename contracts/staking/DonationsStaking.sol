// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

pragma experimental ABIEncoderV2;

import "../Interfaces.sol";
import "./SimpleStaking.sol";
import "../utils/DAOUpgradeableContract.sol";

/**
 * @title DonationStaking contract that receives funds in ETH/StakingToken
 * and stake them in the SimpleStaking contract
 */
contract DonationsStaking is DAOUpgradeableContract {
	SimpleStaking public stakingContract;
	ERC20 public stakingToken;
	Uniswap public uniswap;
	bool public active;
	uint256 public totalETHDonated;
	//max percentage of weth/token pool liquidity 
	uint24 public maxLiquidityPercentageSwap = 300; //0.3%
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

	function initialize(INameService _ns, address _stakingContract)
		public
		initializer
	{
		setDAO(_ns);
		uniswap = Uniswap(_ns.getAddress("UNISWAP_ROUTER"));
		stakingContract = SimpleStaking(_stakingContract);
		stakingToken = stakingContract.token();
		stakingToken.approve(address(stakingContract), type(uint256).max); //we trust the staking contract
		active = true;
	}

	/**
	 * @dev stake available funds. It
	 * take balance in eth and buy stakingToken from uniswap then stake outstanding StakingToken balance.
	 * anyone can call this.
	 */
	function stakeDonations()
		public
		payable
		isActive
	{
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
		(uint256 stakingAmount, ) =
			stakingContract.getProductivity(address(this));
		return stakingAmount;
	}

	/**
	 * @dev internal method to buy stakingToken from uniswap
	 * @return eth value converted
	 */
	function _buyStakingToken()
		internal
		returns (uint256)
	{
		//buy from uniwasp
		uint256 ethBalance = address(this).balance;
		if (ethBalance == 0) return 0;
		address[] memory path = new address[](2);
		path[0] = uniswap.WETH();
		path[1] = address(stakingToken);
		uint safeAmount = maxSafeTokenAmount(ethBalance);
		uniswap.swapExactETHForTokens{ value: safeAmount }(
			0,
			path,
			address(this),
			block.timestamp
		);
		return ethBalance;
	}

	function setActive(bool _active) public {
		_onlyAvatar();
		active = _active;
	}

	/**
	 * @dev withdraws all stakes and then transfer all balances to avatar
	 * this can also be called by owner(Foundation) but it is safe as funds are transfered to avatar
	 * and only avatar can upgrade this contract logic
	 */
	function withdraw() public returns (uint256, uint256) {
		_onlyAvatar();
		(uint256 stakingAmount, ) =
			stakingContract.getProductivity(address(this));
		if (stakingAmount > 0)
			stakingContract.withdrawStake(stakingAmount, false);
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
	function setStakingContract(address _stakingContract) external {
		_onlyAvatar();
		(uint256 stakingAmount, ) =
			stakingContract.getProductivity(address(this));
		if (stakingAmount > 0)
			stakingContract.withdrawStake(stakingAmount, false);
		uint256 stakingTokenBalance = stakingToken.balanceOf(address(this));
		uint256 ethBalance = address(this).balance;
		stakingToken.transfer(avatar, stakingTokenBalance);
		address payable receiver = payable(avatar);
		receiver.transfer(ethBalance);
		stakingContract = SimpleStaking(_stakingContract);
		stakingToken = stakingContract.token();
		stakingToken.approve(address(stakingContract), type(uint256).max); //we trust the staking contract
	}

	/**
	 *@dev Helper to calculate percentage out of token liquidity in pool that is safe to exchange against sandwich attack.
	 * also checks if token->eth has better safe limit, so perhaps doing tokenA->eth->tokenB is better than tokenA->tokenB
	 * in that case it could be that eth->tokenB can be attacked because we dont know if eth received for tokenA->eth is less than _maxPercentage of the liquidity in
	 * eth->tokenB. In our use case it is always eth->dai so either it will be safe or very minimal
	 *@param _inTokenAmount amount of in token required to swap
	 */
	function maxSafeTokenAmount(
		uint256 _inTokenAmount
	) public view returns (uint256 safeAmount) {
		address inToken = uniswap.WETH();
		address outToken = address(stakingToken);
		UniswapPair pair = UniswapPair(
			UniswapFactory(uniswap.factory()).getPair(inToken, outToken)
		);
		(uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
		uint112 reserve = reserve0;
		if (inToken == pair.token1()) {
			reserve = reserve1;
		}

		safeAmount = (reserve * maxLiquidityPercentageSwap) / 100000;

		return safeAmount < _inTokenAmount ? safeAmount : _inTokenAmount;
	}
}
