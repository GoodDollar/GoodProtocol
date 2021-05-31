// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../reserve/GoodReserveCDai.sol";
import "../Interfaces.sol";
import "../utils/DSMath.sol";
import "../utils/DAOUpgradeableContract.sol";

interface StakingContract {
	function collectUBIInterest(address recipient)
		external
		returns (uint256, uint256);

	function iToken() external view returns (address);

	function currentUBIInterest() external view returns (uint256, uint256);

	function getRewardEarned(address user) external view returns (uint256);

	function getGasCostForInterestTransfer() external view returns (uint256);

	function rewardsMinted(
		address user,
		uint256 rewardsPerBlock,
		uint256 blockStart,
		uint256 blockEnd
	) external returns (uint256);
}

/**
 * @title GoodFundManager contract that transfer interest from the staking contract
 * to the reserve contract and transfer the return mintable tokens to the staking
 * contract
 * cDAI support only
 */
contract GoodFundManager is DAOUpgradeableContract, DSMath {
	// timestamp that indicates last time that interests collected
	uint256 public lastCollectedInterest;

	// Last block number which `transferInterest`
	// has been executed in
	uint256 public lastTransferred;
	// Gas cost for mint ubi+bridge ubi+mint rewards
	uint256 gasCostExceptInterestCollect;
	// Gas cost for minting GD for keeper
	uint256 gdMintGasCost;
	// how much time since last collectInterest should pass in order to cancel gas cost multiplier requirement for next collectInterest
	uint256 collectInterestTimeThreshold;
	// to allow keeper to collect interest, total interest collected should be interestMultiplier*gas costs
	uint8 interestMultiplier;
	//address of the active staking contracts
	address[] public activeContracts;

	//Structure that hold reward information and if its blacklicksted or not for particular staking Contract
	struct Reward {
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
		uint256 gdReward
	);

	function _reserveHasInitialized() internal view {
		require(
			nameService.addresses(nameService.RESERVE()) != address(0x0),
			"reserve has not initialized"
		);
	}

	/**
	 * @dev Constructor
	 * @param _ns The address of the name Service
	 */
	function initialize(NameService _ns) public virtual initializer {
		setDAO(_ns);
		gdMintGasCost = 250000; // While testing highest amount was 240k so put 250k to be safe
		collectInterestTimeThreshold = 5184000; // 5184000 is 2 months in seconds
		interestMultiplier = 4;
		gasCostExceptInterestCollect = 850000; //while testing highest amount was 800k so put 850k to be safe
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
	 * @dev Set gas cost to mint GD rewards for keeper
	 * @param _gasAmount amount of gas to spend for minting gd reward
	 */
	function setGasCost(uint256 _gasAmount) public {
		_onlyAvatar();
		gdMintGasCost = _gasAmount;
	}

	/**
	 * @dev Set collectInterestTimeThreshold to determine how much time should pass after collectInterest called to cancel out multiplier for collected interest
	 * @param _timeThreshold new threshold in seconds
	 */
	function setCollectInterestTimeThreshold(uint256 _timeThreshold) public {
		_onlyAvatar();
		collectInterestTimeThreshold = _timeThreshold;
	}

	/**
	 * @dev Set multiplier to determine how much times larger should be collected interest than spent gas when threshold did not pass
	 */
	function setInterestMultiplier(uint8 _newMultiplier) public {
		_onlyAvatar();
		interestMultiplier = _newMultiplier;
	}

	/**
	 * @dev Set Gas cost for needed further transactions after collect interests in collectInterest function
	 * @dev _gasAmount The gas amount that needed for further transactions
	 */
	function setGasCostExceptInterestCollect(uint256 _gasAmount) public {
		_onlyAvatar();
		gasCostExceptInterestCollect = _gasAmount;
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
	) public {
		_onlyAvatar();

		//we dont allow to undo blacklisting as it will mess up rewards accounting.
		//staking contracts are assumed immutable and thus non fixable
		require(
			false ==
				(_isBlackListed == false &&
					rewardsForStakingContract[_stakingAddress].isBlackListed ==
					true),
			"can't undo blacklisting"
		);
		Reward memory reward =
			Reward(
				_rewardsPerBlock,
				_blockStart > 0 ? _blockStart : uint32(block.number),
				_blockEnd > 0 ? _blockEnd : 0xFFFFFFFF,
				_isBlackListed
			);
		rewardsForStakingContract[_stakingAddress] = reward;

		bool exist;
		uint8 i;
		for (i = 0; i < activeContracts.length; i++) {
			if (activeContracts[i] == _stakingAddress) {
				exist = true;
				break;
			}
		}

		if (exist && (_isBlackListed || _rewardsPerBlock == 0)) {
			activeContracts[i] = activeContracts[activeContracts.length - 1];
			activeContracts.pop();
		} else if (!exist && !(_isBlackListed || _rewardsPerBlock == 0)) {
			activeContracts.push(_stakingAddress);
		}
	}

	/**
	 * @dev Collects UBI interest in iToken from a given staking contract and transfers
	 * that interest to the reserve contract. Then transfers the given gd which
	 * received from the reserve contract back to the staking contract and to the
	 * bridge, which locks the funds and then the GD tokens are been minted to the
	 * given address on the sidechain
	 */
	function collectInterest(address[] memory _stakingContracts) public {
		uint256 initialGas = gasleft();
		_reserveHasInitialized();
		cERC20 iToken = cERC20(nameService.getAddress("CDAI"));
		ERC20 daiToken = ERC20(nameService.getAddress("DAI"));
		address reserveAddress = nameService.addresses(nameService.RESERVE());
		// DAI balance of the reserve contract
		uint256 currentBalance = daiToken.balanceOf(reserveAddress);
		uint256 cDAIBalance = iToken.balanceOf(reserveAddress);
		for (uint256 i = _stakingContracts.length - 1; i >= 0; i--) {
			// elements are sorted by balances from lowest to highest

			if (_stakingContracts[i] != address(0x0)) {
				StakingContract(_stakingContracts[i]).collectUBIInterest(
					reserveAddress
				);
			}

			if (i == 0) break; // when active contracts length is 1 then gives error
		}
		// Finds the actual transferred DAI
		uint256 interest = daiToken.balanceOf(reserveAddress) - currentBalance;
		// Convert DAI to cDAI and continue further transactions with cDAI
		GoodReserveCDai(reserveAddress).convertDAItoCDAI(interest);
		uint256 interestInCdai = iToken.balanceOf(reserveAddress) - cDAIBalance;
		// Mints gd while the interest amount is equal to the transferred amount
		uint256 gdUBI =
			GoodReserveCDai(reserveAddress).mintUBI(
				iToken,
				interestInCdai // interest
			);
		IGoodDollar token =
			IGoodDollar(nameService.addresses(nameService.GOODDOLLAR()));
		if (gdUBI > 0) {
			//transfer ubi to avatar on sidechain via bridge
			require(
				token.transferAndCall(
					nameService.addresses(nameService.BRIDGE_CONTRACT()),
					gdUBI,
					abi.encodePacked(
						nameService.addresses(nameService.UBI_RECIPIENT())
					)
				),
				"ubi bridge transfer failed"
			);
		}
		uint256 totalUsedGas =
			((initialGas - gasleft() + gdMintGasCost) * 110) / 100; // We will return as reward 1.1x of used gas in GD
		uint256 gdRewardToMint = getGasPriceInGD(totalUsedGas);
		GoodReserveCDai(reserveAddress).mintRewardFromRR(
			nameService.getAddress("CDAI"),
			msg.sender,
			gdRewardToMint
		);
		uint256 gasPriceIncDAI = getGasPriceInCDAI(initialGas - gasleft());
		if (
			block.timestamp >=
			lastCollectedInterest + collectInterestTimeThreshold
		) {
			require(
				interestInCdai >= gasPriceIncDAI,
				"Collected interest value should be larger than spent gas costs"
			); // This require is necessary to keeper can not abuse this function
		} else {
			require(
				interestInCdai >= interestMultiplier * gasPriceIncDAI,
				"Collected interest value should be interestMultiplier x gas costs"
			);
		}
		emit FundsTransferred(
			msg.sender,
			reserveAddress,
			_stakingContracts,
			interestInCdai,
			gdUBI,
			gdRewardToMint
		);
		lastCollectedInterest = block.timestamp;
	}

	/**
	 * @dev  Function that get addresses of staking contracts which interests
	 * can be collected with the gas amount that provided as parameter
	 * @param _maxGasAmount The maximum amount of the gas that keeper willing to spend collect interests
	 * @return addresses of the staking contracts to the collect interests
	 */
	function calcSortedContracts(uint256 _maxGasAmount)
		public
		view
		returns (address[] memory)
	{
		uint256 activeContractsLength = activeContracts.length;
		address[] memory addresses = new address[](activeContractsLength);
		uint256[] memory balances = new uint256[](activeContractsLength);
		uint256 tempInterest;
		uint256 totalInterest;
		int256 i;
		for (i = 0; i < int256(activeContractsLength); i++) {
			(, tempInterest) = StakingContract(activeContracts[uint256(i)])
				.currentUBIInterest();
			totalInterest += tempInterest;
			if (tempInterest != 0) {
				addresses[uint256(i)] = activeContracts[uint256(i)];
				balances[uint256(i)] = tempInterest;
			}
		}
		uint256 gasCostInUSD = getGasPriceInUsd(_maxGasAmount); // Get gas price in USD so can compare with possible interest amount to get
		address[] memory emptyArray = new address[](0);

		quick(balances, addresses); // sort the values according to interest balance
		uint256 gasCost;
		uint256 possibleCollected;
		for (i = int256(activeContractsLength) - 1; i >= 0; i--) {
			// elements are sorted by balances from lowest to highest

			if (addresses[uint256(i)] != address(0x0)) {
				gasCost = StakingContract(addresses[uint256(i)])
					.getGasCostForInterestTransfer();
				if (_maxGasAmount - gasCost >= gasCostExceptInterestCollect) {
					// collects the interest from the staking contract and transfer it directly to the reserve contract
					//`collectUBIInterest` returns (iTokengains, tokengains, precission loss, donation ratio)
					possibleCollected += balances[uint256(i)];
					_maxGasAmount = _maxGasAmount - gasCost;
				} else {
					break;
				}
			} else {
				break; // if addresses are null after this element then break because we initialize array in size activecontracts but if their interest balance is zero then we dont put it in this array
			}
		}
		while (i > -1) {
			addresses[uint256(i)] = address(0x0);
			i -= 1;
		}
		if (
			block.timestamp >=
			lastCollectedInterest + collectInterestTimeThreshold
		) {
			if (possibleCollected < gasCostInUSD) return emptyArray;
		} else {
			if (possibleCollected < interestMultiplier * gasCostInUSD)
				return emptyArray;
		}
		return addresses;
	}

	/**
	 * @dev Mint to users reward tokens which they earned by staking contract
	 * @dev _user user to get rewards
	 */
	function mintReward(address _token, address _user) public {
		Reward memory staking = rewardsForStakingContract[address(msg.sender)];
		require(staking.blockStart > 0, "Staking contract not registered");
		uint256 amount =
			StakingContract(address(msg.sender)).rewardsMinted(
				_user,
				staking.blockReward,
				staking.blockStart,
				staking.blockEnd
			);
		if (amount > 0 && staking.isBlackListed == false) {
			GoodReserveCDai(nameService.addresses(nameService.RESERVE()))
				.mintRewardFromRR(_token, _user, amount);
		}
	}

	function quick(uint256[] memory data, address[] memory addresses)
		internal
		pure
	{
		if (data.length > 1) {
			quickPart(data, addresses, 0, data.length - 1);
		}
	}

	/**
     @dev quicksort algorithm to sort array
     */
	function quickPart(
		uint256[] memory data,
		address[] memory addresses,
		uint256 low,
		uint256 high
	) internal pure {
		if (low < high) {
			uint256 pivotVal = data[(low + high) / 2];

			uint256 low1 = low;
			uint256 high1 = high;
			for (;;) {
				while (data[low1] < pivotVal) low1++;
				while (data[high1] > pivotVal) high1--;
				if (low1 >= high1) break;
				(data[low1], data[high1]) = (data[high1], data[low1]);
				(addresses[low1], addresses[high1]) = (
					addresses[high1],
					addresses[low1]
				);
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
	function getGasPriceInCDAI(uint256 _gasAmount)
		public
		view
		returns (uint256)
	{
		AggregatorV3Interface gasPriceOracle =
			AggregatorV3Interface(nameService.getAddress("GAS_PRICE_ORACLE"));
		int256 gasPrice = gasPriceOracle.latestAnswer(); // returns gas price in 0 decimal as GWEI so 1eth / 1e9 eth

		AggregatorV3Interface daiETHOracle =
			AggregatorV3Interface(nameService.getAddress("DAI_ETH_ORACLE"));
		int256 daiInETH = daiETHOracle.latestAnswer(); // returns DAI price in ETH

		uint256 result = ((uint256(gasPrice) * 1e18) / uint256(daiInETH)); // Gasprice in GWEI and daiInETH is 18 decimals so we multiply gasprice with 1e18 in order to get result in 18 decimals
		result =
			(((result / 1e10) * 1e28) /
				cERC20(nameService.getAddress("CDAI")).exchangeRateStored()) *
			_gasAmount; // based on https://compound.finance/docs#protocol-math
		return result;
	}

	function getGasPriceInUsd(uint256 _gasAmount)
		public
		view
		returns (uint256)
	{
		AggregatorV3Interface gasPriceOracle =
			AggregatorV3Interface(nameService.getAddress("GAS_PRICE_ORACLE"));
		int256 gasPrice = gasPriceOracle.latestAnswer(); // returns gas price in 0 decimal as GWEI so 1eth / 1e9 eth
		AggregatorV3Interface ethUsdOracle =
			AggregatorV3Interface(nameService.getAddress("ETH_USD_ORACLE"));
		int256 ethInUsd = ethUsdOracle.latestAnswer(); // returns eth price in USD
		return (_gasAmount * uint256(gasPrice) * uint256(ethInUsd)) / 1e18; // gasPrice is 18 decimals and ethInUSD is in 8 decimals since we wanted to get result in 8 decimals we divide to 1e18 at the end
	}

	function getGasPriceInGD(uint256 _gasAmount) public view returns (uint256) {
		uint256 priceInCdai = getGasPriceInCDAI(_gasAmount);
		uint256 gdPriceIncDAI =
			GoodReserveCDai(nameService.addresses(nameService.RESERVE()))
				.currentPrice();
		return rdiv(priceInCdai, gdPriceIncDAI) / 1e25; // rdiv returns result in 27 decimals since GD$ in 2 decimals then divide 1e25
	}

	function getActiveContractsCount() public view returns (uint256) {
		return activeContracts.length;
	}
}
