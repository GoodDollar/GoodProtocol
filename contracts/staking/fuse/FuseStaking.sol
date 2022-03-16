// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract FuseStaking is ERC20, Pausable, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct UserInfo {
        uint256 amount; // Amount of staked tokens
        int256[] rewardDebts;   // Reward debts for all reward tokens
    }

    struct Reward {
        address rewardToken;    // Reward token address
        uint128 accRewardPerShare;  // Accumulated reward per share
        uint256 lastBalance;    // Balance of this contract at the last moment when pool was updated
        uint256 payedRewardForPeriod;   // Reward amount payed for all the period
    }

    struct FeeReceiver {
        address receiver;   // Address of fee receiver
        uint256 bps; // Amount of reward token for the receiver (in BPs)
        mapping(address => bool) isTokenAllowedToBeChargedOfFees;   // Map if fee will be charged on this token
    }

    uint256 public totalStaked; // Total amount of staked tokens
    uint256 public startTime;   // Timestamp when the vault was configured
    IERC20 public immutable stakeToken;   // Stake token address

    Reward[] public rewards;    // Array of reward tokens addresses

    mapping(uint256 => FeeReceiver) public feeReceivers;  // Reward token receivers
    uint256 public feeReceiversLength;  // Reward token receivers count

    mapping(address => UserInfo) public userInfo;  // User address -> User info

    uint256 private constant ACC_REWARD_PRECISION = 1e12;

    event Deposit(address indexed user, uint256 amount, address indexed to);
    event Withdraw(address indexed user, uint256 amount, address indexed to);
    event Staked(address indexed user, uint256 amount, address indexed to);

    /**
    * @param _rewardToken reward token (XBF)
    * @param _stakeToken stake token (LP)
    * @param _xbfInflation XBFInflation address
    * @param _name LP Vault token name
    * @param _symbol LP Vault token symbol
    * @param _referralProgramAddress Referral program contract address
    * @param _gaugeAddress Gauge contract address (can be zero address)
    */
    constructor(
        address _rewardToken,
        IERC20 _stakeToken,
        string memory _name,
        string memory _symbol,
    ) ERC20(_name, _symbol) {
        rewards.push(Reward(_rewardToken, 0, 0, 0));
        stakeToken = _stakeToken;
        _pause();
    }

    /**
    * @notice Deletes all fee receivers
    * @dev Can be called only by owner
    */
    function deleteAllFeeReceivers() external onlyOwner {
        feeReceiversLength = 0;
    }

    /**
    * @notice Adds fee receiver
    * @dev Can be called only by owner
    * @param _receiver New receiver address
    * @param _bps Amount of BPs for the new receiver
    * @param _isFeeReceivingCallNeeded Flag if feeReceiving() call needed
    * @param _rewardsTokens Reward token addresses
    * @param _statuses Flags if vault should pay fee on this token or not
    * @return feeReceiverIndex Index of the new added receiver
    */
    function addFeeReceiver(
        address _receiver,
        uint256 _bps,
        address[] calldata _rewardsTokens,
        bool[] calldata _statuses
    )
        external
        onlyOwner
        returns(uint256 feeReceiverIndex)
    {
        feeReceiverIndex = feeReceiversLength++;
        FeeReceiver storage feeReceiver = feeReceivers[feeReceiverIndex];
        feeReceiver.receiver = _receiver;
        feeReceiver.bps = _bps;
        feeReceiver.isFeeReceivingCallNeeded = _isFeeReceivingCallNeeded;
        for (uint256 i; i < _rewardsTokens.length; i++) {
            _setFeeReceiversTokensToBeChargedOfFees(feeReceiverIndex, _rewardsTokens[i], _statuses[i]);
        }
    }

    /**
    * @notice Returns reward token array length
    */
    function rewardsCount() external view returns(uint256) {
        return rewards.length;
    }

    /**
    * @notice Sets fee receiver address
    * @dev Can be called only by owner
    * @param _index Receiver index
    * @param _receiver New receiver address
    */
    function setFeeReceiverAddress(uint256 _index, address _receiver) external onlyOwner {
        feeReceivers[_index].receiver = _receiver;
    }

    /**
    * @notice Sets BPs for fee receiver
    * @dev Can be called only by owner
    * @param _index Receiver index
    * @param _bps New receiver BPs
    */
    function setFeeReceiverBps(uint256 _index, uint256 _bps) external onlyOwner {
        feeReceivers[_index].bps = _bps;
    }

    /**
    * @notice Sets isFeeReceivingCallNeeded flag for fee receiver
    * @dev Can be called only by owner
    * @param _index Receiver index
    * @param _isFeeReceivingCallNeeded New flag
    */
    function setFeeReceiversCallNeeded(uint256 _index, bool _isFeeReceivingCallNeeded) external onlyOwner {
        feeReceivers[_index].isFeeReceivingCallNeeded = _isFeeReceivingCallNeeded;
    }

    /**
    * @notice Sets isTokenAllowedToBeChargedOfFees flag for specified token at specified fee receiver
    * @dev Can be called only by owner
    * @param _index Receiver index
    * @param _rewardsToken Reward token address to change isTokenAllowedToBeChargedOfFees status
    * @param _status New status for isTokenAllowedToBeChargedOfFees flag
    */
    function setFeeReceiversTokensToBeChargedOfFees(uint256 _index, address _rewardsToken, bool _status) external onlyOwner {
        _setFeeReceiversTokensToBeChargedOfFees(_index, _rewardsToken, _status);
    }

    /**
    * @notice Sets isTokenAllowedToBeChargedOfFees flags for several fee receivers
    * @dev Can be called only by owner
    * @param _indices Receivers indices
    * @param _rewardsTokens Reward tokens addresses to change isTokenAllowedToBeChargedOfFees statuses
    * @param _statuses New statuses for isTokenAllowedToBeChargedOfFees flags
    */
    function setFeeReceiversTokensToBeChargedOfFeesMulti(
        uint256[] calldata _indices,
        address[] calldata _rewardsTokens,
        bool[] calldata _statuses
    ) external onlyOwner {
        for (uint256 i; i < _indices.length; i++) {
            _setFeeReceiversTokensToBeChargedOfFees(_indices[i], _rewardsTokens[i], _statuses[i]);
        }
    }

    /**
    * @notice Sets XBF Inflation contract address
    * @dev can be called only by owner
    * @param _xbfInflation new XBF Inflation contract address
    */
    function setXbfInflation(address _xbfInflation) external onlyOwner {
        xbfInflation = _xbfInflation;
    }

    /**
    * @notice Sets gauge
    * @dev Can be called only by owner
    * @param _gauge New gauge address
    */
    function setGauge(address _gauge, address[] memory _gaugeRewardTokens) external onlyOwner {
        gaugeAddress = _gauge;
        IGauge gauge = IGauge(_gauge);
        Reward memory xbfInfo = rewards[0];
        delete rewards;
        // we should keep current reward parameters for XBF
        rewards.push(
            Reward(
                IXBFInflation(xbfInflation).token(),
                xbfInfo.accRewardPerShare,
                xbfInfo.lastBalance,
                xbfInfo.payedRewardForPeriod
                )
            );
        for (uint256 i; i < _gaugeRewardTokens.length; i++) {
            rewards.push(Reward(_gaugeRewardTokens[i], 0, 0, 0));
        }
    }

    /**
    * @notice Sets Referral program contract address
    * @dev Can be called only by owner
    * @param _refProgram New Referral program contract address
    */
    function setReferralProgram(address _refProgram) external onlyOwner {
        referralProgram = IReferralProgram(_refProgram);
    }

    /**
    * @notice Sets VSR contract address
    * @dev Can be called only by owner
    * @param _vsr New VSR contract address
    */
    function setVotingStakingRewards(address _vsr) external onlyOwner {
        votingStakingRewards = IAutoStakeFor(_vsr);
    }

    /**
    * @notice Sets the flag if fee on getting reward is claimed or not
    * @dev Can be called only by owner
    * @param _isEnabled New onGetRewardFeesEnabled status
    */
    function setOnGetRewardFeesEnabled(bool _isEnabled) external onlyOwner {
        isGetRewardFeesEnabled = _isEnabled;
    }

    /**
    * @notice Sets deposit fee BPs
    * @dev can be called only by owner
    * @param _bps New deposit fee BPs
    */
    function setDepositFeeBps(uint256 _bps) external onlyOwner {
        depositFeeBps = _bps;
    }

    /**
    * @notice Sets deposit fee receiver
    * @dev can be called only by owner
    * @param _receiver New deposit fee receiver
    */
    function setDepositFeeReceiver(address _receiver) external onlyOwner {
        depositFeeReceiver = _receiver;
    }

    /**
    * @notice Configures Vault
    * @dev can be called only by XBF Inflation
    */
    function configure() external onlyXBFInflation whenPaused {
        _unpause();
        _depositFor(1 wei, owner());
        startTime = block.timestamp;
    }

    /**
    * @notice Returns user's reward debt
    * @param _account User's address
    * @param _index Index of reward token
    */
    function getRewardDebt(address _account, uint256 _index) external view returns(int256) {
        if (_index < userInfo[_account].rewardDebts.length) return userInfo[_account].rewardDebts[_index];
        return 0;
    }

    /**
    * @notice Adds reward token
    * @dev Can be called only by owner
    * @param _newToken New reward token
    */

    function addRewardToken(address _newToken) external onlyOwner {
        rewards.push(Reward(_newToken, 0, 0, 0));
        updatePool();
        emit NewRewardToken(_newToken);
    }

    /**
    * @notice Returns user's earned reward
    * @param _user User's address
    * @param _index Index of reward token
    * @return pending Amount of pending reward
    */
    function earned(address _user, uint256 _index) external view returns (uint256 pending) {
        UserInfo storage user = userInfo[_user];
        Reward[] memory _rewards = rewards;
        require(_index < _rewards.length, "index exceeds amount of reward tokens");
        uint256 accRewardPerShare_ = _rewards[_index].accRewardPerShare;
        uint256 lpSupply = totalStaked;
        address gauge = gaugeAddress;
        uint256 vaultEarned;
        if (_index == 0) {
            uint256 target = IXBFInflation(xbfInflation).targetMinted();
            uint256 weigth = IXBFInflation(xbfInflation).weights(address(this));
            uint256 sumWeight = IXBFInflation(xbfInflation).sumWeight();

            uint256 periodsToPay = (block.timestamp - startTime) / IXBFInflation(xbfInflation).periodDuration();
            uint256 mintForPeriods = periodsToPay * IXBFInflation(xbfInflation).periodicEmission();
            uint256 plannedToMint = mintForPeriods > target ? target : mintForPeriods;
            vaultEarned = (plannedToMint - IXBFInflation(xbfInflation).totalMinted()) * weigth / sumWeight;

        } else if (_index > 0 && gauge != address(0) && _index < IGauge(gauge).rewardsListLength() + 1) {
            vaultEarned = IGauge(gauge).earned(_rewards[_index].rewardToken, address(this));
        }
        uint256 balance = IERC20(_rewards[_index].rewardToken).balanceOf(address(this));
        uint256 rewardForPeriod = balance + vaultEarned - (_rewards[_index].lastBalance - _rewards[_index].payedRewardForPeriod);
        if (lpSupply != 0) {
            uint256 reward = rewardForPeriod;
            accRewardPerShare_ += reward * ACC_REWARD_PRECISION / lpSupply;
        }
        if (_index < user.rewardDebts.length) {
            pending = uint256(int256(user.amount * accRewardPerShare_ / ACC_REWARD_PRECISION) - user.rewardDebts[_index]);
        } else {
            pending = user.amount * accRewardPerShare_ / ACC_REWARD_PRECISION;
        }
    }

    /**
    * @notice Updates pool
    * @dev Mints XBF if available, claims all reward from the gauge
    */
    function updatePool() public whenNotPaused {
        Reward[] memory _rewards = rewards;
        uint256 length = _rewards.length;
        address[] memory rewardTokens = new address[](length - 1);
        for (uint256 i; i < length - 1; i++) {   // skip 0th
            rewardTokens[i] = _rewards[i + 1].rewardToken;
        }
        address gauge = gaugeAddress;
        if (gauge != address(0)) IGauge(gauge).getReward(address(this), rewardTokens);
        IXBFInflation(xbfInflation).mintForContracts();
        uint256[] memory rewardsForPeriod = new uint256[](length);
        uint256 lpSupply = totalStaked;
        uint256 multiplier = ACC_REWARD_PRECISION;
        for (uint256 i; i < length; i++) {
            uint256 balance = IERC20(_rewards[i].rewardToken).balanceOf(address(this)); // get the balance after claim/mint
            rewardsForPeriod[i] = balance - (_rewards[i].lastBalance - _rewards[i].payedRewardForPeriod);   // calculate how much reward came from the last time
            rewards[i].lastBalance = balance;
            rewards[i].payedRewardForPeriod = 0;
            if (lpSupply > 0) rewards[i].accRewardPerShare += uint128(rewardsForPeriod[i] * multiplier / lpSupply);
        }

        emit LogUpdatePool(lpSupply, rewardsForPeriod);
    }

    /**
    * @notice Deposits stake tokens for user for reward allocation
    * @param _amount Amount of tokens to deposit
    * @param _to Address of a beneficiary
    */
    function depositFor(uint256 _amount, address _to) public nonReentrant whenNotPaused {
        address sender = _msgSender();

        _amount = _chargeFeesOnDeposit(_amount);

        _depositFor(_amount, _to);
        _mint(address(this), _amount);
        IERC20 stake = stakeToken;
        address gauge = gaugeAddress;
        IReferralProgram referral = referralProgram;
        stake.safeTransferFrom(sender, address(this), _amount);
        if (gauge != address(0)){
            stake.safeApprove(gauge, _amount);
            IGauge(gauge).deposit(_amount, 0);
        }

        if(!referral.users(_to).exists) {
            address rootAddress = referral.rootAddress();
            referral.registerUser(rootAddress, _to);
        }

        emit Deposit(sender, _amount, _to);
        emit Wrapped(sender, _amount, _to);
    }

    /**
    * @notice Stakes Vault LP tokens for user for reward allocation
    * @param _amount Amount of Vault LP tokens to stake
    * @param _to Address of a beneficiary
    */
    function stakeFor(uint256 _amount, address _to) public nonReentrant whenNotPaused {
        _depositFor(_amount, _to);

        address gauge = gaugeAddress;
        if (gauge != address(0)) {
            stakeToken.safeApprove(gauge, _amount);
            IGauge(gauge).deposit(_amount, 0);
        }

        _transfer(_msgSender(), address(this), _amount);
        emit Staked(_msgSender(), _amount, _to);
    }

    /**
    * @notice Unwraps Vault LP token to underlying LP tokens.
    * @dev Burns Vault LP tokens
    * @param _amount Vault LP token amount to unwrap.
    * @param _to The receiver of underlying LP tokens.
    */
    function unwrap(uint256 _amount, address _to) public nonReentrant whenNotPaused {
        address sender = _msgSender();
        _burn(sender, _amount);
        stakeToken.safeTransfer(_to, _amount);
        emit Unwrapped(sender, _amount, _to);
    }


    /**
    * @notice Withdraw Vault LP tokens.
    * @dev Withdraws underlying tokens from Gauge, transfers Vault LP to 'to' address
    * @param _amount Vault LP token amount to unwrap.
    * @param _to The receiver of underlying LP tokens.
    */
    function withdraw(uint256 _amount, address _to) public nonReentrant whenNotPaused {
        _withdraw(_amount);

        address gauge = gaugeAddress;
        if (gauge != address(0)) IGauge(gauge).withdraw(_amount);
        _transfer(address(this), _to, _amount);
        emit Withdraw(_msgSender(), _amount, _to);
    }

    /**
    * @notice Harvest all available reward for the user.
    * @param _to The receiver of the reward tokens.
    */
    function getReward(address _to) public nonReentrant whenNotPaused {
        updatePool();
        address sender = _msgSender();
        UserInfo storage user = userInfo[sender];
        Reward[] memory _rewards = rewards;
        uint256 rewardsLength = _rewards.length;
        uint256[] memory _pendingRewards = new uint256[](rewardsLength);
        uint256 multiplier = ACC_REWARD_PRECISION;

        // Interactions
        for (uint256 i; i < rewardsLength; i++) {
            int256 accumulatedReward = int256(user.amount * _rewards[i].accRewardPerShare / multiplier);
            if (i >= user.rewardDebts.length) user.rewardDebts.push(0);
            _pendingRewards[i] = uint256(accumulatedReward - user.rewardDebts[i]);

            user.rewardDebts[i] = accumulatedReward;
            if (_pendingRewards[i] > 0) {
                address rewardTokenAddress = _rewards[i].rewardToken;
                uint256 rewardsAmountWithFeesTaken = _chargeFees(sender, rewardTokenAddress, _pendingRewards[i]);
                _autoStakeForOrSendTo(rewardTokenAddress, rewardsAmountWithFeesTaken, _to);
                rewards[i].payedRewardForPeriod += _pendingRewards[i];
                _pendingRewards[i] = rewardsAmountWithFeesTaken;
            }
        }

        emit Harvest(sender, _pendingRewards);
    }

    /**
    * @notice Withdraw tokens from Vault and harvest reward for transaction sender to `_to`
    * @param _amount LP token amount to withdraw
    * @param _to Receiver of the LP tokens and rewards
    */
    function withdrawAndHarvest(uint256 _amount, address _to) public nonReentrant whenNotPaused {
        updatePool();
        address sender = _msgSender();
        UserInfo storage user = userInfo[_msgSender()];
        Reward[] memory _rewards = rewards;
        uint256 multiplier = ACC_REWARD_PRECISION;
        // Effects
        user.amount -= _amount;
        totalStaked -= _amount;

        uint256 rewardsLength = _rewards.length;
        uint256[] memory _pendingRewards = new uint256[](rewardsLength);


        for (uint256 i; i < rewardsLength; i++) {
            if (i >= user.rewardDebts.length) {
                user.rewardDebts.push(-int256(_amount * _rewards[i].accRewardPerShare / multiplier));
            } else {
                user.rewardDebts[i] -= int256(_amount * _rewards[i].accRewardPerShare / multiplier);
            }
            int256 accumulatedReward = int256(user.amount * _rewards[i].accRewardPerShare / multiplier);
            _pendingRewards[i] = uint256(accumulatedReward - user.rewardDebts[i]);

            user.rewardDebts[i] = accumulatedReward;
            if (_pendingRewards[i] > 0) {
                address rewardTokenAddress = _rewards[i].rewardToken;
                uint256 rewardsAmountWithFeesTaken = _chargeFees(sender, rewardTokenAddress, _pendingRewards[i]);
                _autoStakeForOrSendTo(rewardTokenAddress, rewardsAmountWithFeesTaken, _to);
                rewards[i].payedRewardForPeriod += _pendingRewards[i];
                _pendingRewards[i] = rewardsAmountWithFeesTaken;
            }
        }

        address gauge = gaugeAddress;
        if(gauge != address(0)) IGauge(gauge).withdraw(_amount);
        _transfer(address(this), _to, _amount);

        emit Harvest(sender, _pendingRewards);
        emit Withdraw(_msgSender(), _amount, _to);


    }

    function _depositFor(uint256 _amount, address _to) internal {
        updatePool();
        UserInfo storage user = userInfo[_to];
        Reward[] memory _rewards = rewards;
        // Effects
        uint256 multiplier = ACC_REWARD_PRECISION;

        user.amount += _amount;
        for (uint256 i; i < _rewards.length; i++) {
            if (i >= user.rewardDebts.length) {
                user.rewardDebts.push(int256(_amount * _rewards[i].accRewardPerShare / multiplier));
            } else {
                user.rewardDebts[i] += int256(_amount * _rewards[i].accRewardPerShare / multiplier);
            }
        }
        totalStaked += _amount;

    }

    function _withdraw(uint256 _amount) internal {
        updatePool();
        UserInfo storage user = userInfo[_msgSender()];
        Reward[] memory _rewards = rewards;
        uint256 multiplier = ACC_REWARD_PRECISION;
        // Effects
        for (uint256 i; i < _rewards.length; i++) {
            if (i >= user.rewardDebts.length) {
                user.rewardDebts.push(-int256(_amount * _rewards[i].accRewardPerShare / multiplier));
            } else {
                user.rewardDebts[i] -= int256(_amount * _rewards[i].accRewardPerShare / multiplier);
            }
        }
        user.amount -= _amount;
        totalStaked -= _amount;

    }

    function _chargeFees(
        address _sender,
        address _rewardToken,
        uint256 _amount
    ) internal returns (uint256) {
        if (!isGetRewardFeesEnabled) {
            return _amount;
        }
        uint256 fee;
        uint256 amountAfterFee = _amount;
        for (uint256 i = 0; i < feeReceiversLength; i++) {
            FeeReceiver storage _feeReceiver = feeReceivers[i];
            if (_feeReceiver.isTokenAllowedToBeChargedOfFees[_rewardToken]) {
                fee = _feeReceiver.bps * _amount / 10000;
                IERC20(_rewardToken).safeTransfer(_feeReceiver.receiver, fee);
                amountAfterFee -= fee;
            }
        }
        return amountAfterFee;
    }

    function _setFeeReceiversTokensToBeChargedOfFees(uint256 _index, address _rewardsToken, bool _status) internal {
        feeReceivers[_index].isTokenAllowedToBeChargedOfFees[_rewardsToken] = _status;
    }

}
