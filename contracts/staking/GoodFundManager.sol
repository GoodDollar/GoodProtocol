// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "../reserve/GoodReserveCDai.sol";


import "../Interfaces.sol";
import "hardhat/console.sol";
interface StakingContract {
    function collectUBIInterest(address recipient)
        external
        returns (uint256, uint256, uint256, uint256);

    function iToken() external view returns(address); 
    function currentUBIInterest()
        external
        view
        returns (uint256,uint256,uint256);
    function updateGlobalGDYieldPerToken(
        uint256 _blockGDInterest,
        uint256 _blockInterestTokenEarned
        ) 
    external;
    function getGasCostForInterestTransfer() external view returns(uint);
    
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

    //address of the activate staking contracts
    address[] public activeContracts;
   
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
        uint256 gdUBI
    );

    modifier reserveHasInitialized {
        require(address(reserve) != address(0x0), "reserve has not initialized");
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
        public
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
     * @dev Add active contract to active contracts array
     * @param _stakingContract address of the staking contract
     */
    function addActiveStakingContract(address _stakingContract)public onlyAvatar{
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
    function removeActiveStakingContract(address _stakingContract)public onlyAvatar{
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
    )
        public
        onlyAvatar
    {
        bridgeContract = _bridgeContract;
        ubiRecipient = _recipient;
    }

    /**
     * @dev Allows the DAO to change the block interval
     * @param _blockInterval the new interval value
     */
    function setBlockInterval(
        uint256 _blockInterval
    )
        public
        onlyAvatar
    {
        blockInterval = _blockInterval;
    }

    /**
     * @dev Checks if enough time has passed away since the
     * last funds transfer time
     * @return (bool) True if enough time has passed
     */
    function canRun() public view returns(bool)
    {
        return block.number.div(blockInterval) > lastTransferred;
    }

    /**
     * @dev Collects UBI interest in iToken from a given staking contract and transfers
     * that interest to the reserve contract. Then transfers the given gd which
     * received from the reserve contract back to the staking contract and to the
     * bridge, which locks the funds and then the GD tokens are been minted to the
     * given address on the sidechain
     */
    function collectInterest()
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
        uint256 currentBalance = iToken.balanceOf(address(reserve));
        uint256 tempInterest;
		uint activeContractsLength = activeContracts.length;
        address[] memory addresses = new address[](activeContractsLength); 
        uint256[] memory balances = new uint256[](activeContractsLength); 
		uint i;
        uint totalInterest;
		require(activeContractsLength > 0 , "There should be at least one active staking contract");
        for (i = 0; i < activeContractsLength; i++){
            (tempInterest, ,) = StakingContract(activeContracts[i]).currentUBIInterest();
            totalInterest += tempInterest;
            if (tempInterest != 0){
                addresses[i] = activeContracts[i];
                balances[i] = tempInterest;
            }
        }
        
        uint gasCostInCdai = getGasPriceInCDAI(initialGas); // Get gas price in cDAI so can compare with possible interest amount to get
        require(totalInterest >= gasCostInCdai,"Collected interest should be bigger than spent gas amount");
        quick(balances,addresses); // sort the values according to interest balance
        uint leftGas = gasleft();
        uint gasCost;
       
		
		uint tempInitialGas = initialGas; // to prevent stack too deep error
        for(i = activeContractsLength - 1; i >= 0; i--){ // zxelements are sorted by balances from lowest to highest 
		
            if(addresses[i] != address(0x0)){
                gasCost = StakingContract(addresses[i]).getGasCostForInterestTransfer();
				
                if(leftGas - gasCost >= 200000){ // this value will change its hardcoded for ubi minting
                    // collects the interest from the staking contract and transfer it directly to the reserve contract
                    //`collectUBIInterest` returns (iTokengains, tokengains, precission loss, donation ratio)
					
                    StakingContract(addresses[i]).collectUBIInterest(
                        address(reserve)
                    );
                    leftGas -= gasCost;
                }else{
					break; // if there is no more gas to perform mintUBI so on then break
                }
            }else{
                break; // if addresses are null after this element then break
            }
            if(i == 0) break; // when active contracts length is 1 then gives error
        }
		
        // Finds the actual transferred iToken
        uint interest = iToken.balanceOf(address(reserve)).sub(
            currentBalance
        );
        
        
        // Mints gd while the interest amount is equal to the transferred amount
        (uint256 gdUBI) = reserve.mintInterestAndUBI(
            iToken,
            interest // interest
        );
        //_staking.updateGlobalGDYieldPerToken(gdInterest, interest);
        // Transfers the minted tokens to the given staking contract
        IGoodDollar token = IGoodDollar(address(avatar.nativeToken()));
        //if(gdInterest > 0)
          //  require(token.transfer(address(_staking), gdInterest),"interest transfer failed");
        if(gdUBI > 0)
            //transfer ubi to avatar on sidechain via bridge
            require(token.transferAndCall(
                bridgeContract,
                gdUBI,
                abi.encodePacked(ubiRecipient)
            ),"ubi bridge transfer failed");
        uint256 totalUsedGas = (tempInitialGas - gasleft()) * 110 / 100; // We will return as reward 1.1x of used gas in GD
        uint256 gdAmountToMint= getGasPriceInGD(totalUsedGas);
        // We need mintRewardFromRR from PR for #39
        emit FundsTransferred(
            msg.sender,
            address(reserve),
            interest,
            gdUBI 
        );
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
        GoodDollar token = GoodDollar(address(avatar.nativeToken()));
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
        uint gdPriceIncDAI = reserve.currentPrice();
        return rdiv(priceInCdai,gdPriceIncDAI) / 1e25; // rdiv returns result in 27 decimals since GD$ in 2 decimals then divide 1e25
    }
    function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(10**27).add(y / 2) / y;
	}

}
