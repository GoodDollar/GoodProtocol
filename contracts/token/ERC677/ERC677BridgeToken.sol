pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20Burnable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./interfaces/IBurnableMintableERC677Token.sol";
import "./ERC865.sol";
import "./ERC677Receiver.sol";
import "./libraries/Message.sol";
import "./interfaces/ITransferManager.sol";
import "./interfaces/IRestrictedToken.sol";

contract ERC677BridgeToken is
    IBurnableMintableERC677Token,
    IRestrictedToken,
    ERC20Detailed,
    ERC20Burnable,
    ERC20Mintable,
    Ownable,
    ERC865 {

    address public bridgeContract;
    ITransferManager public transferManager;

    event ContractFallbackCallFailed(address from, address to, uint value);

    constructor(
        string _name,
        string _symbol,
        uint8 _decimals)
    public ERC20Detailed(_name, _symbol, _decimals) {}

    function setBridgeContract(address _bridgeContract) onlyMinter public {
        require(_bridgeContract != address(0) && isContract(_bridgeContract));
        bridgeContract = _bridgeContract;
    }

    function setTransferManager(address _transferManager) onlyOwner public {
        require(_transferManager != address(0) && isContract(_transferManager));
        transferManager = ITransferManager(_transferManager);

        emit TransferManagerSet(_transferManager);
    }

    modifier validRecipient(address _recipient) {
        require(_recipient != address(0) && _recipient != address(this));
        _;
    }

    function verifyTransfer(address _from, address _to, uint256 _value) public view returns (bool) {
      if (transferManager != address(0)) {
        return transferManager.verifyTransfer(_from, _to, _value);
      } else {
        return true;
      }
    }

    function transferAndCall(address _to, uint _value, bytes _data)
        external validRecipient(_to) returns (bool)
    {
        require(superTransfer(_to, _value));
        emit Transfer(msg.sender, _to, _value, _data);

        if (isContract(_to)) {
            require(contractFallback(_to, _value, _data));
        }
        return true;
    }

    function getTokenInterfacesVersion() public pure returns(uint64 major, uint64 minor, uint64 patch) {
        return (3, 0, 0);
    }

    function superTransfer(address _to, uint256 _value) internal returns(bool)
    {
        require(verifyTransfer(msg.sender, _to, _value));
        return super.transfer(_to, _value);
    }

    /**
   * @dev ERC20 transfer with a contract fallback.
   * Contract fallback to bridge is a special, That's the transfer to other network
   * @param _to The address to transfer to.
   * @param _value The amount to be transferred.
   */
    function transfer(address _to, uint256 _value) public returns (bool)
    {
        require(superTransfer(_to, _value));
        if (isContract(_to) && !contractFallback(_to, _value, new bytes(0))) {
            if (_to == bridgeContract) {
                revert();
            } else {
                emit ContractFallbackCallFailed(msg.sender, _to, _value);
            }
        }
        return true;
    }

    function contractFallback(address _to, uint _value, bytes _data)
        private
        returns(bool)
    {
        return _to.call(abi.encodeWithSignature("onTokenTransfer(address,uint256,bytes)",  msg.sender, _value, _data));
    }

    function isContract(address _addr)
        internal
        view
        returns (bool)
    {
        uint length;
        assembly { length := extcodesize(_addr) }
        return length > 0;
    }

    function renounceOwnership() public onlyOwner {
        revert();
    }

    /**
   * @dev Claims token or ether sent by mistake to the token contract
   * @param _token The address to the token sent a null for ether.
   * @param _to The address to to sent the tokens.
   */
    function claimTokens(address _token, address _to) public onlyOwner {
        require(_to != address(0));
        if (_token == address(0)) {
            _to.transfer(address(this).balance);
            return;
        }

        ERC20Detailed token = ERC20Detailed(_token);
        uint256 balance = token.balanceOf(address(this));
        require(token.transfer(_to, balance));
    }

    function transferWithFee(address _sender, address _from, address _to, uint256 _value, uint256 _fee) internal returns(bool)
    {
        require(verifyTransfer(_from, _to, _value));
        require(verifyTransfer(_from, _sender, _fee));
        _transfer(_from, _to, _value);
        _transfer(_from, _sender, _fee);
        return true;
    }

    function contractFallbackFrom(address _from, address _to, uint _value, bytes _data) private returns(bool)
    {
        return _to.call(abi.encodeWithSignature("onTokenTransfer(address,uint256,bytes)",  _from, _value, _data));
    }

    function transferPreSigned(bytes _signature, address _to, uint256 _value, uint256 _fee, uint256 _timestamp) validRecipient(_to) public returns (bool) {
        bytes32 hashedParams = getTransferPreSignedHash(address(this), _to, _value, _fee, _timestamp);
        address from = Message.recover(hashedParams, _signature);
        require(from != address(0), "Invalid from address recovered");
        bytes32 hashedTx = keccak256(abi.encodePacked(from, hashedParams));
        require(hashedTxs[hashedTx] == false, "Transaction hash was already used");

        require(transferWithFee(msg.sender, from, _to, _value, _fee));
        hashedTxs[hashedTx] = true;
        emit TransferPreSigned(from, _to, msg.sender, _value, _fee);

        if (isContract(_to) && !contractFallbackFrom(from, _to, _value, new bytes(0))) {
            if (_to == bridgeContract) {
                revert();
            } else {
                emit ContractFallbackCallFailed(from, _to, _value);
            }
        }

        return true;
    }

    function getTransferPreSignedHash(address _token, address _to, uint256 _value, uint256 _fee, uint256 _timestamp) public pure returns (bytes32) {
        /* "0d98dcb1": getTransferPreSignedHash(address,address,uint256,uint256,uint256) */
        return keccak256(abi.encodePacked(bytes4(0x0d98dcb1), _token, _to, _value, _fee, _timestamp));
    }

    function transferAndCallPreSigned(bytes _signature, address _to, uint256 _value, bytes _data, uint256 _fee, uint256 _timestamp) validRecipient(_to) public returns (bool) {
        bytes32 hashedParams = getTransferAndCallPreSignedHash(address(this), _to, _value, _data, _fee, _timestamp);
        address from = Message.recover(hashedParams, _signature);
        require(from != address(0), "Invalid from address recovered");
        bytes32 hashedTx = keccak256(abi.encodePacked(from, hashedParams));
        require(hashedTxs[hashedTx] == false, "Transaction hash was already used");

        require(transferWithFee(msg.sender, from, _to, _value, _fee));
        hashedTxs[hashedTx] = true;
        emit TransferAndCallPreSigned(from, _to, msg.sender, _value, _data, _fee);

        if (isContract(_to)) {
            require(contractFallbackFrom(from, _to, _value, _data));
        }
        return true;
    }

    function getTransferAndCallPreSignedHash(address _token, address _to, uint256 _value, bytes _data, uint256 _fee, uint256 _timestamp) public pure returns (bytes32) {
        /* "cabc0a10": getTransferPreSignedHash(address,address,uint256,uint256,uint256) */
        return keccak256(abi.encodePacked(bytes4(0xcabc0a10), _token, _to, _value, _data, _fee, _timestamp));
    }
}
