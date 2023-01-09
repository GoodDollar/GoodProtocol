pragma solidity >=0.8.0;
import "../reserve/ExchangeHelper.sol";

contract BuyAndBridgeHelper {
	struct BuyParams {
		address[] buyPath;
		uint256 tokenAmount;
		uint256 minReturn;
		uint256 minDAIAmount;
		address targetAddress;
	}

	uint256 public constant CELO = 42220;
	uint256 public constant FUSE = 122;

	ExchangeHelper public exHelper;

	address public gd;
	address public gdx;
	address public fuseBridge;
	IMultichainRouter public multiChainBridge;
	address public anyGoodDollar; //G$ multichain wrapper on ethereum

	constructor(ExchangeHelper _exh) {
		exHelper = _exh;
		updateAddresses();
	}

	function updateAddresses() public {
		fuseBridge = exHelper.nameService().getAddress("BRIDGE_CONTRACT");
		multiChainBridge = IMultichainRouter(
			exHelper.nameService().getAddress("MULTICHAIN_ROUTER")
		);
		anyGoodDollar = exHelper.nameService().getAddress(
			"MULTICHAIN_ANYGOODDOLLAR"
		);
		gd = exHelper.nameService().getAddress("GOODDOLLAR");
		gdx = exHelper.nameService().getAddress("RESERVE");
	}

	function buyAndBridge(BuyParams memory _params, uint256 _toChain)
		public
		payable
		returns (uint256)
	{
		require(_toChain == FUSE || _toChain == CELO, "invalid chainId");
		uint256 valueToSend;
		if (_params.buyPath[0] != address(0)) {
			ERC20(_params.buyPath[0]).approve(address(exHelper), type(uint256).max);
			ERC20(_params.buyPath[0]).transferFrom(
				msg.sender,
				address(this),
				_params.tokenAmount
			);
		} else {
			valueToSend = _params.tokenAmount;
		}

		address recipient = _params.targetAddress == address(0)
			? msg.sender
			: _params.targetAddress;

		//we send bought G$s here
		uint256 bought = exHelper.buy{ value: valueToSend }(
			_params.buyPath,
			_params.tokenAmount,
			_params.minReturn,
			_params.minDAIAmount,
			address(this)
		);

		require(bought > 0, "buy failed");

		address gdx = exHelper.nameService().getAddress("RESERVE");
		//make sure we send GDX we received to buyer
		if (ERC20(gdx).balanceOf(address(this)) >= bought) {
			require(ERC20(gdx).transfer(msg.sender, bought), "gdx");
		}
		bridge(_toChain, recipient, bought);
	}

	/**
	 * @notice internal function that takes care of sending the G$s according to the transfer type
	 * @param _recipient data about the recipient
	 * @param _amount how much to send
	 */
	function bridge(
		uint256 _toChain,
		address _recipient,
		uint256 _amount
	) internal {
		if (_toChain == FUSE) {
			IGoodDollar(gd).transferAndCall(
				fuseBridge,
				_amount,
				abi.encodePacked(_recipient)
			);
		} else if (_toChain == CELO) {
			IGoodDollar(gd).approve(address(multiChainBridge), _amount);
			multiChainBridge.anySwapOutUnderlying(
				anyGoodDollar,
				_recipient,
				_amount,
				_toChain
			);
		}
	}
}
