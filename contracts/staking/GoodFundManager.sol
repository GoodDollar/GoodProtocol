// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "../reserve/GoodReserveCDai.sol";

import "hardhat/console.sol";
import "../Interfaces.sol";
interface StakingContract {
	function collectUBIInterest(address recipient)
		external
		returns (
			uint256,
			uint256,
			uint256
		);

    function iToken() external view returns(address); 
    function currentUBIInterest()
        external
        view
        returns (uint256,uint256,uint256);
    function getRewardEarned(address user) external view returns(uint);
    
    function getGasCostForInterestTransfer() external view returns(uint);
    

    function rewardsMinted(address user) external returns(uint);

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
    // timestamp that indicates last time that interests collected
    uint256 public lastCollectedInterest; 

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

    //address of the activate staking contracts
    address[] public activeContracts;
   
    //Structure that hold reward information and if its blacklicksted or not for particular staking Contract
    struct Reward{
        uint32 blockReward; //in G$
        uint64 blockStart; // # of the start block to distribute rewards
        uint64 blockEnd; // # of the end block to distribute rewards
        bool isBlackListed; // If staking contract is blacklisted or not
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
        //address indexed staking,
        // The reserve contract address
        address indexed reserve,
        //addresses of the staking contracts
        address[] indexed stakings,
        // Amount of cDai that was transferred
        // from the staking contract to the
        // reserve contract
        uint256 cDAIinterestEarned,
        
        // The number of tokens that have been minted
        // by the reserve to the staking contract
        //uint256 gdInterest,
        // The number of tokens that have been minted
        // by the reserve to the bridge which in his
        // turn should transfer those funds to the
        // sidechain
        uint256 gdUBI,
        // Amount of GD to be minted as reward 
        //to the keeper which collect interests
        uint256 gdAmountToMint
    );

	modifier reserveHasInitialized {
		require(
			nameService.addresses(nameService.RESERVE()) != address(0x0),
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
    ) public{
		_onlyAvatar();
        Reward memory reward = Reward(_rewardsPerBlock, _blockStart, _blockEnd, _isBlackListed);
        rewardsForStakingContract[_stakingAddress] = reward;
    }
    /**
     * @dev Add active contract to active contracts array
     * @param _stakingContract address of the staking contract
     */
    function addActiveStakingContract(address _stakingContract) public {
        _onlyAvatar();
        //check if address exists in array
        bool exist;
        for (uint8 i=0; i < activeContracts.length; i++){
            if(activeContracts[i] == _stakingContract){
                exist = true;
                break;
            }
        }
        require(exist == false , "Staking contract address already exist");
        activeContracts.push(_stakingContract);
    }
    /**
     * @dev Remove active contract from active contracts array
     * @param _stakingContract address of the staking contract
     */
    function removeActiveStakingContract(address _stakingContract) public {
        _onlyAvatar();
        uint index;
        bool exist;
        for (uint8 i=0; i < activeContracts.length; i++){ 
            if(activeContracts[i] == _stakingContract){
                exist = true;
                index = i;
                break;
            }
        }
        require(exist==true, "There is no such a address to delete");
        activeContracts[index] = activeContracts[activeContracts.length - 1];
        activeContracts.pop();
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
     * @dev Collects UBI interest in iToken from a given staking contract and transfers
     * that interest to the reserve contract. Then transfers the given gd which
     * received from the reserve contract back to the staking contract and to the
     * bridge, which locks the funds and then the GD tokens are been minted to the
     * given address on the sidechain
     */
    function collectInterest(address[] memory _stakingContracts)
        public
        reserveHasInitialized
        //requireDAOContract(address(_staking))
    {
        // require(
        //     canRun(),
        //     "Need to wait for the next interval"
        // );
        uint initialGas = gasleft();
        lastTransferred = block.number.div(blockInterval);
        ERC20 iToken = ERC20(nameService.getAddress("CDAI"));
        // iToken balance of the reserve contract
        uint256 currentBalance = iToken.balanceOf(nameService.addresses(nameService.RESERVE()));
        
        for(uint i = _stakingContracts.length - 1; i >= 0; i--){ // zxelements are sorted by balances from lowest to highest 
		
            if(_stakingContracts[i] != address(0x0)){
                StakingContract(_stakingContracts[i]).collectUBIInterest(
                    nameService.addresses(nameService.RESERVE()));
                    }
                   
            if(i == 0) break; // when active contracts length is 1 then gives error
        }
       
        // Finds the actual transferred iToken
        uint interest = iToken.balanceOf(nameService.addresses(nameService.RESERVE())) - currentBalance;
        uint gasPriceIncDAI = getGasPriceInCDAI(initialGas);
        if (block.timestamp >= lastCollectedInterest + 5184000){ // 5184000 is 2 months in seconds
            require(interest >= gasPriceIncDAI, "Collected interest should be bigger than spent gas"); // This require is necessary to keeper can not abuse this function
        }else{
            require(interest >= 4 * gasPriceIncDAI, "Collected interests should be at least 4 times bigger than gas cost since last call of this function sooner than 2 months");
        }
        // Mints gd while the interest amount is equal to the transferred amount
        (uint256 gdUBI) = GoodReserveCDai(nameService.addresses(nameService.RESERVE())).mintUBI(
            iToken,
            interest // interest
        );
        // Transfers the minted tokens to the given staking contract
        IGoodDollar token = IGoodDollar(address(avatar.nativeToken()));
        
        if(gdUBI > 0)
            //transfer ubi to avatar on sidechain via bridge
            require(token.transferAndCall(
                bridgeContract,
                gdUBI,
                abi.encodePacked(ubiRecipient)
            ),"ubi bridge transfer failed");
        uint256 gasCostToMintReward = 200000; // Gas cost to mint GD reward to keeper hardcoded so should be changed according to calculations
        uint256 totalUsedGas = (initialGas - gasleft() + gasCostToMintReward) * 110 / 100; // We will return as reward 1.1x of used gas in GD 
        uint256 gdAmountToMint= getGasPriceInGD(totalUsedGas);
        GoodReserveCDai(nameService.addresses(nameService.RESERVE())).mintRewardFromRR(nameService.getAddress("CDAI"),msg.sender,gdAmountToMint);
        lastCollectedInterest = block.timestamp;
        emit FundsTransferred(
            msg.sender,
            nameService.addresses(nameService.RESERVE()),
            _stakingContracts,
            interest,
            gdUBI,
            gdAmountToMint
        );
    }

    /**
     * @dev  Function that get addresses of staking contracts which interests 
     * can be collected with the gas amount that provided as parameter
     * @param _maxGasAmount The maximum amount of the gas that keeper willing to spend collect interests
     * @return addresses of the staking contracts to the collect interests
     */
    function calcSortedContracts(uint256 _maxGasAmount) public view returns(address[] memory){
        uint activeContractsLength = activeContracts.length;
        address[] memory addresses = new address[](activeContractsLength); 
        uint256[] memory balances = new uint256[](activeContractsLength);
        uint256 tempInterest;
        uint totalInterest;
        int i;
        require(activeContractsLength > 0 , "There should be at least one active staking contract");
        for (i = 0; i < int(activeContractsLength); i++){
            (tempInterest, ,) = StakingContract(activeContracts[uint(i)]).currentUBIInterest();
            totalInterest += tempInterest;
            if (tempInterest != 0){
                addresses[uint(i)] = activeContracts[uint(i)];
                balances[uint(i)] = tempInterest;
            }
        }
        uint gasCostInCdai = getGasPriceInCDAI(_maxGasAmount); // Get gas price in cDAI so can compare with possible interest amount to get
        require(totalInterest >= gasCostInCdai,"Current interest's worth less than spent gas worth");
        quick(balances,addresses); // sort the values according to interest balance
        uint gasCost;
        uint possibleCollected;
        for(i = int(activeContractsLength) - 1; i >= 0; i--){ // elements are sorted by balances from lowest to highest 
		
            if(addresses[uint(i)] != address(0x0)){
                gasCost = StakingContract(addresses[uint(i)]).getGasCostForInterestTransfer();
                if(_maxGasAmount - gasCost >= 650000){ // this value will change. Its hardcoded for further transactions such as ubiMINTING,gas price calculations and gdMINT
                    // collects the interest from the staking contract and transfer it directly to the reserve contract
                    //`collectUBIInterest` returns (iTokengains, tokengains, precission loss, donation ratio)
					possibleCollected += balances[uint(i)];
                    _maxGasAmount = _maxGasAmount - gasCost;
                }else{
					break;
                }
            }else{
                break; // if addresses are null after this element then break because we initialize array in size activecontracts but if their interest balance is zero then we dont put it in this array
            }

        }
      
        while(i > -1){
            addresses[uint(i)] = address(0x0);
            i -= 1;
        }
        if (block.timestamp >= lastCollectedInterest + 5184000){ // 5184000 is 2 months in seconds
            require(possibleCollected >= gasCostInCdai, "Collected interests does not cover gas cost");
        } else{
            require(possibleCollected >= 4 * gasCostInCdai, "Collected interests should be at least 4 times bigger than gas cost since last call of this function sooner than 2 months");
        }
        return addresses;
    }
    /**
     * @dev Mint to users reward tokens which they earned by staking contract
     * @dev _user user to get rewards
     */
     function mintReward(
        address _token,
        address _user

     ) public {
        
        Reward memory staking = rewardsForStakingContract[address(msg.sender)];
        require(staking.blockStart > 0 , "Staking contract not registered");
        uint amount = StakingContract(address(msg.sender)).rewardsMinted(_user);
        if(amount > 0 && staking.isBlackListed == false){
            
            GoodReserveCDai(nameService.addresses(nameService.RESERVE())).mintRewardFromRR(_token, _user, amount);
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
    function quick(uint256[] memory data,address[] memory addresses) internal pure {
        if (data.length > 1) {
            quickPart(data, addresses, 0, data.length - 1);
        }
    }
    /**
     @dev quicksort algorithm to sort array
     */
    function quickPart(uint256[] memory data, address[] memory addresses, uint low, uint high) internal pure {
        if (low < high) {
            uint pivotVal = data[(low + high) / 2];
        
            uint low1 = low;
            uint high1 = high;
            for (;;) {
                while (data[low1] < pivotVal) low1++;
                while (data[high1] > pivotVal) high1--;
                if (low1 >= high1) break;
                (data[low1], data[high1]) = (data[high1], data[low1]);
                (addresses[low1], addresses[high1]) = (addresses[high1], addresses[low1]);
                low1++;
                high1--;
            }
            if (low < high1) quickPart(data, addresses, low, high1);
            high1++;
            if (high1 < high) quickPart(data, addresses, high1, high);
        }
    }
    /**
     @dev Helper function to get gasPrice in GWEI then change it to cDAI
     @param _gasAmount gas amount to be calculated worth in cDAI
     @return Price of the gas which used in cDAI
     */
    function getGasPriceInCDAI(uint256 _gasAmount) public view returns(uint256){
        AggregatorV3Interface gasPriceOracle = AggregatorV3Interface(nameService.getAddress("GAS_PRICE_ORACLE"));
        (,int gasPrice,,,) = gasPriceOracle.latestRoundData(); // returns gas price in 0 decimal as GWEI so 1eth / 1e9 eth


        AggregatorV3Interface daiETHOracle = AggregatorV3Interface(nameService.getAddress("DAI_ETH_ORACLE"));
        (,int daiInETH,,,) = daiETHOracle.latestRoundData(); // returns DAI price in ETH
        
        uint256 result = rdiv(uint(gasPrice) * 1e9 , uint(daiInETH)) / 1e9; // 1 gas amount in DAI gas price in gwei but with 0 decimal so we should multiply it by 1e9 to get value in 18 decimals and after rdiv we should divide 1e9 to obtain value in 18 decimals
        result = rdiv(result * 1e10, cERC20(address(cDai)).exchangeRateStored()) / 1e19 * _gasAmount; // since cDAI token returns exchange rate scaled by 18 so we increase resolution of DAI result as well then divide to each other then multiply by _gasAmount
        return result;


    }
    function getGasPriceInGD(uint256 _gasAmount) public view returns(uint256){
        uint priceInCdai = getGasPriceInCDAI(_gasAmount);
        uint gdPriceIncDAI = GoodReserveCDai(nameService.addresses(nameService.RESERVE())).currentPrice();
        return rdiv(priceInCdai,gdPriceIncDAI) / 1e25; // rdiv returns result in 27 decimals since GD$ in 2 decimals then divide 1e25
    }
    function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(10**27).add(y / 2) / y;
	}

}
