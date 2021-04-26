// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "../reserve/GoodReserveCDai.sol";

import "../Interfaces.sol";

interface StakingContract {
	function collectUBIInterest(address recipient)
		external
		returns (
			uint256,
			uint256,
			uint256,
			uint256
		);

    function iToken() external view returns(address); 
    function getRewardEarned(address user) external view returns(uint);
    function updateGlobalGDYieldPerToken(
        uint256 _blockGDInterest,
        uint256 _blockInterestTokenEarned
        ) 
    external;
    function _mint(address user)
    external returns(uint);

}

/**
 * @title GoodFundManager contract that transfer interest from the staking contract
 * to the reserve contract and transfer the return mintable tokens to the staking
 * contract
 * cDAI support only
 */
contract GoodFundManager is DAOContract {
	using SafeMath for uint256;

	// The address of cDai
	ERC20 public cDai;

	// The address of the reserve contract
	// which recieves the funds from the
	// staking contract
	GoodReserveCDai public reserve;

	uint256 constant DECIMAL1e18 = 10**18;

	// The address of the bridge contract
	// which transfers in his turn the
	// UBI funds to the given recipient
	// address on the sidechain
	address public bridgeContract;

	// The recipient address on the
	// sidechain. The bridge transfers
	// the funds to the following address
	address public ubiRecipient;

	// Determines how many blocks should
	// be passed before the next
	// execution of `transferInterest`
	uint256 public blockInterval;

    // Last block number which `transferInterest`
    // has been executed in
    uint256 public lastTransferred;
    //Structure that hold reward information and if its blacklicksted or not for particular staking Contract
    struct Reward{
        uint32 blockReward; //in G$
        uint32 blockStart; // # of the start block to distribute rewards
        uint32 blockEnd; // # of the end block to distribute rewards
        bool isBlackListed; // If staking contract is blacklisted or not
        bool isInitialized; // if staking contract has actually Initialized
    }
    // Rewards per block for particular Staking contract
    mapping(address => Reward) public rewardsForStakingContract;
    // Emits when `transferInterest` transfers
    // funds to the staking contract and to
    // the bridge
    event FundsTransferred(
        // The caller address
        address indexed caller,
        // The staking contract address
        address indexed staking,
        // The reserve contract address
        address indexed reserve,
        // Amount of cDai that was transferred
        // from the staking contract to the
        // reserve contract
        uint256 cDAIinterestEarned,
        // How much interest has been donated
        // according to the given donation
        // ratio which determined in the
        // staking contract
        uint256 cDAIinterestDonated,
        // The number of tokens that have been minted
        // by the reserve to the staking contract
        uint256 gdInterest,
        // The number of tokens that have been minted
        // by the reserve to the bridge which in his
        // turn should transfer those funds to the
        // sidechain
        uint256 gdUBI
    );

	modifier reserveHasInitialized {
		require(
			address(reserve) != address(0x0),
			"reserve has not initialized"
		);
		_;
	}

    /**
     * @dev Constructor
     * @param _ns The address of the name Service
     * @param _cDai The address of cDai
     * @param _bridgeContract The address of the bridge contract
     * @param _ubiRecipient The recipient address on the sidechain
     * @param _blockInterval How many blocks should be passed before the next execution of `transferInterest
     */
    constructor(
        NameService _ns,
        address _cDai,
        address _bridgeContract,
        address _ubiRecipient,
        uint256 _blockInterval
    )
        
        //ActivePeriod(block.timestamp, block.timestamp * 2, _avatar)
    {
        setDAO(_ns);
        cDai = ERC20(_cDai);
        bridgeContract = _bridgeContract;
        ubiRecipient = _ubiRecipient;
        blockInterval = _blockInterval;
        lastTransferred = block.number.div(blockInterval);
    }

	/**
	 * @dev Start function. Adds this contract to identity as a feeless scheme.
	 * Can only be called if scheme is registered
	 */
	// function start() public onlyRegistered {
	// addRights();
	//   super.start();
	// }

    /**
     * @dev Sets the whitelisted reserve. Only Avatar
     * can call this method.
     * @param _reserve The new reserve to be whitelisted
     */
    function setReserve(GoodReserveCDai _reserve) public onlyAvatar {
        reserve = _reserve;
    }
    /**
     * @dev Sets the Reward for particular Staking contract
     * @param _rewardsPerBlock reward for per block 
     * @param _stakingAddress address of the staking contract
     * @param _blockStart block number for start reward distrubution
     * @param _blockEnd block number for end reward distrubition
     * @param _isBlackListed set staking contract blacklisted or not to prevent minting
     */
    function setStakingReward(
        uint32 _rewardsPerBlock,
        address _stakingAddress,
        uint32 _blockStart,
        uint32 _blockEnd,
        bool _isBlackListed
    ) public onlyAvatar{
        Reward memory reward = Reward(_rewardsPerBlock, _blockStart, _blockEnd, _isBlackListed, true);
        rewardsForStakingContract[_stakingAddress] = reward;
    }
   
    /**
     * @dev sets the token bridge address on mainnet and the recipient of minted UBI (avatar on sidechain)
     * @param _bridgeContract address
     * @param _recipient address
     */

	/**
	 * @dev Sets the bridge address on the current network and the recipient
	 * address on the sidechain. Only Avatar can call this method.
	 * @param _bridgeContract The new bridge address
	 * @param _recipient The new recipient address (NOTICE: this address may be a
	 * sidechain address)
	 */
	function setBridgeAndUBIRecipient(
		address _bridgeContract,
		address _recipient
	) public {
		_onlyAvatar();

		bridgeContract = _bridgeContract;
		ubiRecipient = _recipient;
	}

	/**
	 * @dev Allows the DAO to change the block interval
	 * @param _blockInterval the new interval value
	 */
	function setBlockInterval(uint256 _blockInterval) public {
		_onlyAvatar();
		blockInterval = _blockInterval;
	}

	/**
	 * @dev Checks if enough time has passed away since the
	 * last funds transfer time
	 * @return (bool) True if enough time has passed
	 */
	function canRun() public view returns (bool) {
		return block.number.div(blockInterval) > lastTransferred;
	}

	/**
	 * @dev Collects UBI interest in iToken from a given staking contract and transfers
	 * that interest to the reserve contract. Then transfers the given gd which
	 * received from the reserve contract back to the staking contract and to the
	 * bridge, which locks the funds and then the GD tokens are been minted to the
	 * given address on the sidechain
	 * @param _staking Contract that implements `collectUBIInterest` and transfer iTokeb to
	 * a given address. The given address should be the same whitelisted `reserve`
	 * address in the current contract, in case that the given staking contract transfers
	 * the funds to another contract, zero GD tokens will be minted by the reserve contract.
	 * Emits `FundsTransferred` event in case which interest has been passed to the `reserve`
	 */
	function transferInterest(StakingContract _staking)
		public
		reserveHasInitialized
	//requireDAOContract(address(_staking))
	{
		// require(
		//     canRun(),
		//     "Need to wait for the next interval"
		// );
		lastTransferred = block.number.div(blockInterval);
		ERC20 iToken = ERC20(_staking.iToken());
		// iToken balance of the reserve contract
		uint256 currentBalance = iToken.balanceOf(address(reserve));
		// collects the interest from the staking contract and transfer it directly to the reserve contract
		//`collectUBIInterest` returns (iTokengains, tokengains, precission loss, donation ratio)
		(, , , uint256 avgEffectiveStakedRatio) =
			_staking.collectUBIInterest(address(reserve));

		// Finds the actual transferred iToken
		uint256 interest =
			iToken.balanceOf(address(reserve)).sub(currentBalance);
		uint256 effectiveInterest =
			interest.mul(avgEffectiveStakedRatio).div(DECIMAL1e18);
		uint256 interestDonated = interest.sub(effectiveInterest);
        // Mints gd while the interest amount is equal to the transferred amount
        (uint256 gdInterest, uint256 gdUBI) = reserve.mintInterestAndUBI(
            iToken,
            interest,
            effectiveInterest
        );
        _staking.updateGlobalGDYieldPerToken(gdInterest, interest);
        // Transfers the minted tokens to the given staking contract
        IGoodDollar token = IGoodDollar(address(avatar.nativeToken()));
        if(gdInterest > 0)
            require(token.transfer(address(_staking), gdInterest),"interest transfer failed");
        if(gdUBI > 0)
            //transfer ubi to avatar on sidechain via bridge
            require(token.transferAndCall(
                bridgeContract,
                gdUBI,
                abi.encodePacked(ubiRecipient)
            ),"ubi bridge transfer failed");
        emit FundsTransferred(
            msg.sender,
            address(_staking),
            address(reserve),
            interest,
            interestDonated,
            gdInterest,
            gdUBI
        );
    }
    /**
     * @dev Mint to users reward tokens which they earned by staking contract
     * @dev _user user to get rewards
     */
     function mintReward(
        address _user

     ) public {
        
        Reward memory staking = rewardsForStakingContract[address(msg.sender)];
        uint amount = StakingContract(address(msg.sender))._mint(_user);
        require(staking.isInitialized == true , "Staking contracts reward has not initiliazed");
        if(amount > 0 && staking.isBlackListed == false){
            
            reserve.mintRewardFromRR(_user, amount);
        }
        


     }
    
    /**
     * @dev Making the contract inactive after it has transferred funds to `_avatar`.
     * Only the avatar can destroy the contract.
     */
  /**  function end() public onlyAvatar {
        // Transfers the remaining amount of cDai and GD to the avatar
        uint256 remainingCDaiReserve = cDai.balanceOf(address(this));
        if (remainingCDaiReserve > 0) {
            require(cDai.transfer(address(avatar), remainingCDaiReserve),"cdai transfer failed");
        }
        IGoodDollar token = IGoodDollar(address(avatar.nativeToken()));
        uint256 remainingGDReserve = token.balanceOf(address(this));
        if (remainingGDReserve > 0) {
            require(token.transfer(address(avatar), remainingGDReserve),"gd transfer failed");
        }
        super.internalEnd(avatar);
    }*/
}
