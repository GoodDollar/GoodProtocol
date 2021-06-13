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
	 * @param _minStakingTokenAmount enforce expected return from uniswap when converting eth balance to StakingToken
	 */
	function stakeDonations(uint256 _minStakingTokenAmount)
		public
		payable
		isActive
	{
		uint256 stakingTokenDonated = stakingToken.balanceOf(address(this));
		uint256 ethDonated = _buyStakingToken(_minStakingTokenAmount);

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
	 * @param _minStakingTokenAmount enforce expected return from uniswap when converting eth balance to StakingToken
	 * @return eth value converted
	 */
	function _buyStakingToken(uint256 _minStakingTokenAmount)
		internal
		returns (uint256)
	{
		//buy from uniwasp
		uint256 ethBalance = address(this).balance;
		if (ethBalance == 0) return 0;
		address[] memory path = new address[](2);
		path[0] = uniswap.WETH();
		path[1] = address(stakingToken);
		uniswap.swapExactETHForTokens{ value: ethBalance }(
			_minStakingTokenAmount,
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
}
