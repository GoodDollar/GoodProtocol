// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../utils/DAOUpgradableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "./BaseGovernanceShareField.sol";

/**
 * @title Staking contract that allows citizens to stake G$ to get GDAO rewards
 */
contract GovernanceStaking is
	ERC20Upgradeable,
	BaseGovernanceShareField,
	DAOContract
{
	uint256 public constant FUSE_MONTHLY_BLOCKS = 12 * 60 * 24 * 30;

	// Token address
	ERC20 token;

	// The total staked Token amount in the contract
	// uint256 public totalStaked = 0;

	/**
	 * @dev Emitted when `staker` stake `value` tokens of `token`
	 */
	event Staked(address indexed staker, address token, uint256 value);

	/**
	 * @dev Emitted when `staker` withdraws their stake `value` tokens and contracts balance will
	 * be reduced to`remainingBalance`.
	 */
	event StakeWithdraw(
		address indexed staker,
		address token,
		uint256 value,
		uint256 remainingBalance
	);

	/**
	 * @dev Emitted when `staker` withdraws their rewards `value` tokens
	 */
	event RewardsWithdraw(address indexed staker, uint256 value);

	/**
	 * @dev Constructor
	 * @param _ns The address of the NameService contract
	 */
	constructor(NameService _ns) {
		setDAO(_ns);
		token = ERC20(nameService.addresses(nameService.GOODDOLLAR()));
		__ERC20_init("GDAO Staking", "sGDAO");
		rewardsPerBlock = (2 ether * 1e6) / FUSE_MONTHLY_BLOCKS; // (2M monthly GDAO as specified in specs, divided by blocks in month )
	}

	/**
	 * @dev this contract runs on fuse
	 */
	function getChainBlocksPerMonth() public pure override returns (uint256) {
		return 518400; //12 * 60 * 24 * 30
	}

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of GD to stake
	 */
	function stake(uint256 _amount) external {
		require(_amount > 0, "You need to stake a positive token amount");
		require(
			token.transferFrom(_msgSender(), address(this), _amount),
			"transferFrom failed, make sure you approved token transfer"
		);
		_increaseProductivity(_msgSender(), _amount);
		_mint(_msgSender(), _amount); // mint Staking token for staker
		_mintRewards(_msgSender());
		emit Staked(_msgSender(), address(token), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 */
	function withdrawStake(uint256 _amount) external {
		(uint256 userProductivity, ) = getProductivity(_msgSender());
		if (_amount == 0) _amount = userProductivity;
		require(_amount > 0, "Should withdraw positive amount");
		require(userProductivity >= _amount, "Not enough token staked");
		uint256 tokenWithdraw = _amount;

		_burn(_msgSender(), _amount); // burn their staking tokens
		_decreaseProductivity(_msgSender(), _amount);
		_mintRewards(_msgSender());

		require(
			token.transfer(_msgSender(), tokenWithdraw),
			"withdraw transfer failed"
		);
		emit StakeWithdraw(
			_msgSender(),
			address(token),
			tokenWithdraw,
			token.balanceOf(address(this))
		);
	}

	/**
	 * @dev Staker can withdraw their rewards without withdraw their stake
	 */
	function withdrawRewards() public returns (uint256) {
		return _mintRewards(_msgSender());
	}

	/**
	 * @dev Mint rewards of the staker
	 * @param user Receipent address of the rewards
	 * @return Returns amount of the minted rewards
	 */

	function _mintRewards(address user) internal returns (uint256) {
		uint256 amount = _issueEarnedRewards(user);
		if (amount > 0) {
			ERC20(nameService.addresses(nameService.REPUTATION())).mint(
				user,
				amount
			);
			emit RewardsWithdraw(_msgSender(), amount);
		}
		return amount;
	}

	/**
	 * @dev Returns the number of decimals used to get its user representation.
	 */
	function decimals() public view virtual override returns (uint8) {
		return 2;
	}

	function _transfer(
		address from,
		address to,
		uint256 value
	) internal override {
		_decreaseProductivity(from, value);
		_increaseProductivity(to, value);
		_mintRewards(from);
		_mintRewards(to);
		super._transfer(from, to, value);
	}

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _monthlyAmount total rewards which will distribute monthly
	 */
	function setMonthlyRewards(uint256 _monthlyAmount) public {
		_onlyAvatar();
		_setMonthlyRewards(_monthlyAmount);
	}
}
