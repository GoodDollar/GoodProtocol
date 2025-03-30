// SPDX-License-Identifier: MIT
pragma solidity >=0.8;
pragma experimental ABIEncoderV2;

interface IMentoReserve {
	function setTobinTaxStalenessThreshold(uint256) external;

	function addToken(address) external returns (bool);

	function removeToken(address, uint256) external returns (bool);

	function transferGold(address payable, uint256) external returns (bool);

	function transferExchangeGold(
		address payable,
		uint256
	) external returns (bool);

	function transferCollateralAsset(
		address collateralAsset,
		address payable to,
		uint256 value
	) external returns (bool);

	function getReserveGoldBalance() external view returns (uint256);

	function getUnfrozenReserveGoldBalance() external view returns (uint256);

	function getOrComputeTobinTax() external returns (uint256, uint256);

	function getTokens() external view returns (address[] memory);

	function getReserveRatio() external view returns (uint256);

	function addExchangeSpender(address) external;

	function removeExchangeSpender(address, uint256) external;

	function addSpender(address) external;

	function removeSpender(address) external;

	function isStableAsset(address) external view returns (bool);

	function isCollateralAsset(address) external view returns (bool);

	function getDailySpendingRatioForCollateralAsset(
		address collateralAsset
	) external view returns (uint256);

	function isExchangeSpender(address exchange) external view returns (bool);

	function addCollateralAsset(address asset) external returns (bool);

	function transferExchangeCollateralAsset(
		address collateralAsset,
		address payable to,
		uint256 value
	) external returns (bool);

	function initialize(
		address registryAddress,
		uint256 _tobinTaxStalenessThreshold,
		uint256 _spendingRatioForCelo,
		uint256 _frozenGold,
		uint256 _frozenDays,
		bytes32[] calldata _assetAllocationSymbols,
		uint256[] calldata _assetAllocationWeights,
		uint256 _tobinTax,
		uint256 _tobinTaxReserveRatio,
		address[] calldata _collateralAssets,
		uint256[] calldata _collateralAssetDailySpendingRatios
	) external;

	/// @notice IOwnable:
	function transferOwnership(address newOwner) external;

	function renounceOwnership() external;

	function owner() external view returns (address);

	/// @notice Getters:
	function registry() external view returns (address);

	function tobinTaxStalenessThreshold() external view returns (uint256);

	function tobinTax() external view returns (uint256);

	function tobinTaxReserveRatio() external view returns (uint256);

	function getDailySpendingRatio() external view returns (uint256);

	function checkIsCollateralAsset(
		address collateralAsset
	) external view returns (bool);

	function isToken(address) external view returns (bool);

	function getOtherReserveAddresses() external view returns (address[] memory);

	function getAssetAllocationSymbols() external view returns (bytes32[] memory);

	function getAssetAllocationWeights() external view returns (uint256[] memory);

	function collateralAssetSpendingLimit(
		address
	) external view returns (uint256);

	function getExchangeSpenders() external view returns (address[] memory);

	function getUnfrozenBalance() external view returns (uint256);

	function isOtherReserveAddress(
		address otherReserveAddress
	) external view returns (bool);

	function isSpender(address spender) external view returns (bool);

	/// @notice Setters:
	function setRegistry(address) external;

	function setTobinTax(uint256) external;

	function setTobinTaxReserveRatio(uint256) external;

	function setDailySpendingRatio(uint256 spendingRatio) external;

	function setDailySpendingRatioForCollateralAssets(
		address[] calldata _collateralAssets,
		uint256[] calldata collateralAssetDailySpendingRatios
	) external;

	function setFrozenGold(uint256 frozenGold, uint256 frozenDays) external;

	function setAssetAllocations(
		bytes32[] calldata symbols,
		uint256[] calldata weights
	) external;

	function removeCollateralAsset(
		address collateralAsset,
		uint256 index
	) external returns (bool);

	function addOtherReserveAddress(
		address otherReserveAddress
	) external returns (bool);

	function removeOtherReserveAddress(
		address otherReserveAddress,
		uint256 index
	) external returns (bool);

	function collateralAssets(uint256 index) external view returns (address);

	function collateralAssetLastSpendingDay(
		address collateralAsset
	) external view returns (uint256);
}

interface IBancorExchangeProvider {
	struct PoolExchange {
		address reserveAsset;
		address tokenAddress;
		uint256 tokenSupply;
		uint256 reserveBalance;
		uint32 reserveRatio;
		uint32 exitContribution;
	}

	/* ------- Events ------- */

	/**
	 * @notice Emitted when the broker address is updated.
	 * @param newBroker The address of the new broker.
	 */
	event BrokerUpdated(address indexed newBroker);

	/**
	 * @notice Emitted when the reserve contract is set.
	 * @param newReserve The address of the new reserve.
	 */
	event ReserveUpdated(address indexed newReserve);

	/**
	 * @notice Emitted when a new PoolExchange has been created.
	 * @param exchangeId The id of the new PoolExchange
	 * @param reserveAsset The address of the reserve asset
	 * @param tokenAddress The address of the token
	 */
	event ExchangeCreated(
		bytes32 indexed exchangeId,
		address indexed reserveAsset,
		address indexed tokenAddress
	);

	/**
	 * @notice Emitted when a PoolExchange has been destroyed.
	 * @param exchangeId The id of the PoolExchange
	 * @param reserveAsset The address of the reserve asset
	 * @param tokenAddress The address of the token
	 */
	event ExchangeDestroyed(
		bytes32 indexed exchangeId,
		address indexed reserveAsset,
		address indexed tokenAddress
	);

	/**
	 * @notice Emitted when the exit contribution for a pool is set.
	 * @param exchangeId The id of the pool
	 * @param exitContribution The exit contribution
	 */
	event ExitContributionSet(
		bytes32 indexed exchangeId,
		uint256 exitContribution
	);

	/* ------- Functions ------- */

	/**
	 * @notice Retrieves the pool with the specified exchangeId.
	 * @param exchangeId The id of the pool to be retrieved.
	 * @return exchange The PoolExchange with that ID.
	 */
	function getPoolExchange(
		bytes32 exchangeId
	) external view returns (PoolExchange memory exchange);

	/**
	 * @notice Get all exchange IDs.
	 * @return exchangeIds List of the exchangeIds.
	 */
	function getExchangeIds()
		external
		view
		returns (bytes32[] memory exchangeIds);

	/**
	 * @notice Create a PoolExchange with the provided data.
	 * @param exchange The PoolExchange to be created.
	 * @return exchangeId The id of the exchange.
	 */
	function createExchange(
		PoolExchange calldata exchange
	) external returns (bytes32 exchangeId);

	/**
	 * @notice Delete a PoolExchange.
	 * @param exchangeId The PoolExchange to be created.
	 * @param exchangeIdIndex The index of the exchangeId in the exchangeIds array.
	 * @return destroyed - true on successful delition.
	 */
	function destroyExchange(
		bytes32 exchangeId,
		uint256 exchangeIdIndex
	) external returns (bool destroyed);

	/**
	 * @notice Set the exit contribution for a given exchange
	 * @param exchangeId The id of the exchange
	 * @param exitContribution The exit contribution to be set
	 */
	function setExitContribution(
		bytes32 exchangeId,
		uint32 exitContribution
	) external;

	/**
	 * @notice gets the current price based of the bancor formula
	 * @param exchangeId The id of the exchange to get the price for
	 * @return price the current continious price
	 */
	function currentPrice(
		bytes32 exchangeId
	) external view returns (uint256 price);
}

interface IGoodDollarExpansionController {
	/**
	 * @notice Struct holding the configuration for the expansion of an exchange.
	 * @param expansionRate The rate of expansion in percentage with 1e18 being 100%.
	 * @param expansionfrequency The frequency of expansion in seconds.
	 * @param lastExpansion The last timestamp an expansion was done.
	 */
	struct ExchangeExpansionConfig {
		uint64 expansionRate;
		uint32 expansionFrequency;
		uint32 lastExpansion;
	}

	/* ------- Events ------- */

	/**
	 * @notice Emitted when the GoodDollarExchangeProvider is updated.
	 * @param exchangeProvider The address of the new GoodDollarExchangeProvider.
	 */
	event GoodDollarExchangeProviderUpdated(address indexed exchangeProvider);

	/**
	 * @notice Emitted when the distribution helper is updated.
	 * @param distributionHelper The address of the new distribution helper.
	 */
	event DistributionHelperUpdated(address indexed distributionHelper);

	/**
	 * @notice Emitted when the Reserve address is updated.
	 * @param reserve The address of the new Reserve.
	 */
	event ReserveUpdated(address indexed reserve);

	/**
	 * @notice Emitted when the AVATAR address is updated.
	 * @param avatar The address of the new AVATAR.
	 */
	event AvatarUpdated(address indexed avatar);

	/**
	 * @notice Emitted when the expansion config is set for an exchange.
	 * @param exchangeId The id of the exchange.
	 * @param expansionRate The rate of expansion.
	 * @param expansionfrequency The frequency of expansion.
	 */
	event ExpansionConfigSet(
		bytes32 indexed exchangeId,
		uint64 expansionRate,
		uint32 expansionfrequency
	);

	/**
	 * @notice Emitted when a reward is minted.
	 * @param exchangeId The id of the exchange.
	 * @param to The address of the recipient.
	 * @param amount The amount of tokens minted.
	 */
	event RewardMinted(
		bytes32 indexed exchangeId,
		address indexed to,
		uint256 amount
	);

	/**
	 * @notice Emitted when UBI is minted through collecting reserve interest.
	 * @param exchangeId The id of the exchange.
	 * @param amount Amount of tokens minted.
	 */
	event InterestUBIMinted(bytes32 indexed exchangeId, uint256 amount);

	/**
	 * @notice Emitted when UBI is minted through expansion.
	 * @param exchangeId The id of the exchange.
	 * @param amount Amount of tokens minted.
	 */
	event ExpansionUBIMinted(bytes32 indexed exchangeId, uint256 amount);

	/* ------- Functions ------- */

	/**
	 * @notice Initializes the contract with the given parameters.
	 * @param _goodDollarExchangeProvider The address of the GoodDollarExchangeProvider contract.
	 * @param _distributionHelper The address of the distribution helper contract.
	 * @param _reserve The address of the Reserve contract.
	 * @param _avatar The address of the GoodDollar DAO contract.
	 */
	function initialize(
		address _goodDollarExchangeProvider,
		address _distributionHelper,
		address _reserve,
		address _avatar
	) external;

	/**
	 * @notice Sets the GoodDollarExchangeProvider address.
	 * @param _goodDollarExchangeProvider The address of the GoodDollarExchangeProvider contract.
	 */
	function setGoodDollarExchangeProvider(
		address _goodDollarExchangeProvider
	) external;

	/**
	 * @notice Sets the distribution helper address.
	 * @param _distributionHelper The address of the distribution helper contract.
	 */
	function setDistributionHelper(address _distributionHelper) external;

	/**
	 * @notice Sets the reserve address.
	 * @param _reserve The address of the reserve contract.
	 */
	function setReserve(address _reserve) external;

	/**
	 * @notice Sets the AVATAR address.
	 * @param _avatar The address of the AVATAR contract.
	 */
	function setAvatar(address _avatar) external;

	/**
	 * @notice Sets the expansion config for the given exchange.
	 * @param exchangeId The id of the exchange to set the expansion config for.
	 * @param expansionRate The rate of expansion.
	 * @param expansionFrequency The frequency of expansion.
	 */
	function setExpansionConfig(
		bytes32 exchangeId,
		uint64 expansionRate,
		uint32 expansionFrequency
	) external;

	/**
	 * @notice Mints UBI for the given exchange from collecting reserve interest.
	 * @param exchangeId The id of the exchange to mint UBI for.
	 * @param reserveInterest The amount of reserve tokens collected from interest.
	 */
	function mintUBIFromInterest(
		bytes32 exchangeId,
		uint256 reserveInterest
	) external;

	/**
	 * @notice Mints UBI for the given exchange by comparing the reserve Balance of the contract to the virtual balance.
	 * @param exchangeId The id of the exchange to mint UBI for.
	 * @return amountMinted The amount of UBI tokens minted.
	 */
	function mintUBIFromReserveBalance(
		bytes32 exchangeId
	) external returns (uint256 amountMinted);

	/**
	 * @notice Mints UBI for the given exchange by calculating the expansion rate.
	 * @param exchangeId The id of the exchange to mint UBI for.
	 * @return amountMinted The amount of UBI tokens minted.
	 */
	function mintUBIFromExpansion(
		bytes32 exchangeId
	) external returns (uint256 amountMinted);

	/**
	 * @notice Mints a reward of tokens for the given exchange.
	 * @param exchangeId The id of the exchange to mint reward.
	 * @param to The address of the recipient.
	 * @param amount The amount of tokens to mint.
	 */
	function mintRewardFromRR(
		bytes32 exchangeId,
		address to,
		uint256 amount
	) external;
}

interface IGoodDollarExchangeProvider {
	/* ------- Events ------- */

	/**
	 * @notice Emitted when the ExpansionController address is updated.
	 * @param expansionController The address of the ExpansionController contract.
	 */
	event ExpansionControllerUpdated(address indexed expansionController);

	/**
	 * @notice Emitted when the AVATAR address is updated.
	 * @param AVATAR The address of the AVATAR contract.
	 */
	// solhint-disable-next-line var-name-mixedcase
	event AvatarUpdated(address indexed AVATAR);

	/**
	 * @notice Emitted when reserve ratio for exchange is updated.
	 * @param exchangeId The id of the exchange.
	 * @param reserveRatio The new reserve ratio.
	 */
	event ReserveRatioUpdated(bytes32 indexed exchangeId, uint32 reserveRatio);

	/* ------- Functions ------- */

	/**
	 * @notice Initializes the contract with the given parameters.
	 * @param _broker The address of the Broker contract.
	 * @param _reserve The address of the Reserve contract.
	 * @param _expansionController The address of the ExpansionController contract.
	 * @param _avatar The address of the GoodDollar DAO contract.
	 */
	function initialize(
		address _broker,
		address _reserve,
		address _expansionController,
		address _avatar
	) external;

	/**
	 * @notice calculates the amount of tokens to be minted as a result of expansion.
	 * @param exchangeId The id of the pool to calculate expansion for.
	 * @param expansionScaler Scaler for calculating the new reserve ratio.
	 * @return amountToMint amount of tokens to be minted as a result of the expansion.
	 */
	function mintFromExpansion(
		bytes32 exchangeId,
		uint256 expansionScaler
	) external returns (uint256 amountToMint);

	/**
	 * @notice calculates the amount of tokens to be minted as a result of the reserve interest.
	 * @param exchangeId The id of the pool the reserve interest is added to.
	 * @param reserveInterest The amount of reserve tokens collected from interest.
	 * @return amount of tokens to be minted as a result of the reserve interest.
	 */
	function mintFromInterest(
		bytes32 exchangeId,
		uint256 reserveInterest
	) external returns (uint256);

	/**
	 * @notice calculates the reserve ratio needed to mint the reward.
	 * @param exchangeId The id of the pool the reward is minted from.
	 * @param reward The amount of tokens to be minted as a reward.
	 */
	function updateRatioForReward(bytes32 exchangeId, uint256 reward) external;

	/**
	 * @notice pauses the Exchange disables minting.
	 */
	function pause() external;

	/**
	 * @notice unpauses the Exchange enables minting again.
	 */
	function unpause() external;
}

/*
 * @title Broker Interface for trader functions
 * @notice The broker is responsible for executing swaps and keeping track of trading limits.
 */

interface ITradingLimits {
  /**
   * @dev The State struct contains the current state of a trading limit config.
   * @param lastUpdated0 The timestamp of the last reset of netflow0.
   * @param lastUpdated1 The timestamp of the last reset of netflow1.
   * @param netflow0 The current netflow of the asset for limit0.
   * @param netflow1 The current netflow of the asset for limit1.
   * @param netflowGlobal The current netflow of the asset for limitGlobal.
   */
  struct State {
    uint32 lastUpdated0;
    uint32 lastUpdated1;
    int48 netflow0;
    int48 netflow1;
    int48 netflowGlobal;
  }

  /**
   * @dev The Config struct contains the configuration of trading limits.
   * @param timestep0 The time window in seconds for limit0.
   * @param timestep1 The time window in seconds for limit1.
   * @param limit0 The limit0 for the asset.
   * @param limit1 The limit1 for the asset.
   * @param limitGlobal The global limit for the asset.
   * @param flags A bitfield of flags to enable/disable the individual limits.
   */
  struct Config {
    uint32 timestep0;
    uint32 timestep1;
    int48 limit0;
    int48 limit1;
    int48 limitGlobal;
    uint8 flags;
  }
}

/*
 * @title Broker Interface for trader functions
 * @notice The broker is responsible for executing swaps and keeping track of trading limits.
 */
interface IBroker {
  /**
   * @notice Emitted when a swap occurs.
   * @param exchangeProvider The exchange provider used.
   * @param exchangeId The id of the exchange used.
   * @param trader The user that initiated the swap.
   * @param tokenIn The address of the token that was sold.
   * @param tokenOut The address of the token that was bought.
   * @param amountIn The amount of token sold.
   * @param amountOut The amount of token bought.
   */
  event Swap(
    address exchangeProvider,
    bytes32 indexed exchangeId,
    address indexed trader,
    address indexed tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOut
  );

  /**
   * @notice Emitted when a new trading limit is configured.
   * @param exchangeId the exchangeId to target.
   * @param token the token to target.
   * @param config the new trading limits config.
   */
  event TradingLimitConfigured(bytes32 exchangeId, address token, ITradingLimits.Config config);

  /**
   * @notice Allows the contract to be upgradable via the proxy.
   * @param _exchangeProviders The addresses of the ExchangeProvider contracts.
   * @param _reserves The address of the Reserve contract.
   */
  function initialize(address[] calldata _exchangeProviders, address[] calldata _reserves) external;

  /**
   * @notice Set the reserves for the exchange providers.
   * @param _exchangeProviders The addresses of the ExchangeProvider contracts.
   * @param _reserves The addresses of the Reserve contracts.
   */
  function setReserves(address[] calldata _exchangeProviders, address[] calldata _reserves) external;

  /**
   * @notice Add an exchange provider to the list of providers.
   * @param exchangeProvider The address of the exchange provider to add.
   * @param reserve The address of the reserve used by the exchange provider.
   * @return index The index of the newly added specified exchange provider.
   */
  function addExchangeProvider(address exchangeProvider, address reserve) external returns (uint256 index);

  /**
   * @notice Remove an exchange provider from the list of providers.
   * @param exchangeProvider The address of the exchange provider to remove.
   * @param index The index of the exchange provider being removed.
   */
  function removeExchangeProvider(address exchangeProvider, uint256 index) external;

  /**
   * @notice Calculate amountIn of tokenIn needed for a given amountOut of tokenOut.
   * @param exchangeProvider the address of the exchange provider for the pair.
   * @param exchangeId The id of the exchange to use.
   * @param tokenIn The token to be sold.
   * @param tokenOut The token to be bought.
   * @param amountOut The amount of tokenOut to be bought.
   * @return amountIn The amount of tokenIn to be sold.
   */
  function getAmountIn(
    address exchangeProvider,
    bytes32 exchangeId,
    address tokenIn,
    address tokenOut,
    uint256 amountOut
  ) external view returns (uint256 amountIn);

  /**
   * @notice Calculate amountOut of tokenOut received for a given amountIn of tokenIn.
   * @param exchangeProvider the address of the exchange provider for the pair.
   * @param exchangeId The id of the exchange to use.
   * @param tokenIn The token to be sold.
   * @param tokenOut The token to be bought.
   * @param amountIn The amount of tokenIn to be sold.
   * @return amountOut The amount of tokenOut to be bought.
   */
  function getAmountOut(
    address exchangeProvider,
    bytes32 exchangeId,
    address tokenIn,
    address tokenOut,
    uint256 amountIn
  ) external view returns (uint256 amountOut);

  /**
   * @notice Execute a token swap with fixed amountIn.
   * @param exchangeProvider the address of the exchange provider for the pair.
   * @param exchangeId The id of the exchange to use.
   * @param tokenIn The token to be sold.
   * @param tokenOut The token to be bought.
   * @param amountIn The amount of tokenIn to be sold.
   * @param amountOutMin Minimum amountOut to be received - controls slippage.
   * @return amountOut The amount of tokenOut to be bought.
   */
  function swapIn(
    address exchangeProvider,
    bytes32 exchangeId,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOutMin
  ) external returns (uint256 amountOut);

  /**
   * @notice Execute a token swap with fixed amountOut.
   * @param exchangeProvider the address of the exchange provider for the pair.
   * @param exchangeId The id of the exchange to use.
   * @param tokenIn The token to be sold.
   * @param tokenOut The token to be bought.
   * @param amountOut The amount of tokenOut to be bought.
   * @param amountInMax Maximum amount of tokenIn that can be traded.
   * @return amountIn The amount of tokenIn to be sold.
   */
  function swapOut(
    address exchangeProvider,
    bytes32 exchangeId,
    address tokenIn,
    address tokenOut,
    uint256 amountOut,
    uint256 amountInMax
  ) external returns (uint256 amountIn);

  /**
   * @notice Permissionless way to burn stables from msg.sender directly.
   * @param token The token getting burned.
   * @param amount The amount of the token getting burned.
   * @return True if transaction succeeds.
   */
  function burnStableTokens(address token, uint256 amount) external returns (bool);

  /**
   * @notice Configure trading limits for an (exchangeId, token) tuple.
   * @dev Will revert if the configuration is not valid according to the TradingLimits library.
   * Resets existing state according to the TradingLimits library logic.
   * Can only be called by owner.
   * @param exchangeId the exchangeId to target.
   * @param token the token to target.
   * @param config the new trading limits config.
   */
  function configureTradingLimit(bytes32 exchangeId, address token, ITradingLimits.Config calldata config) external;

  /**
   * @notice Get the list of registered exchange providers.
   * @dev This can be used by UI or clients to discover all pairs.
   * @return exchangeProviders the addresses of all exchange providers.
   */
  function getExchangeProviders() external view returns (address[] memory);

  /**
   * @notice Get the address of the exchange provider at a given index.
   * @dev Auto-generated getter for the exchangeProviders array.
   * @param index The index of the exchange provider.
   * @return exchangeProvider The address of the exchange provider.
   */
  function exchangeProviders(uint256 index) external view returns (address exchangeProvider);

  /**
   * @notice Check if a given address is an exchange provider.
   * @dev Auto-generated getter for the isExchangeProvider mapping.
   * @param exchangeProvider The address to check.
   * @return isExchangeProvider True if the address is an exchange provider, false otherwise.
   */
  function isExchangeProvider(address exchangeProvider) external view returns (bool);
}
