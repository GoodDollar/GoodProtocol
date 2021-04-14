pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract ERC865 is ERC20 {
    mapping(bytes32 => bool) hashedTxs;

    event TransferPreSigned(address indexed from, address indexed to, address indexed delegate, uint256 amount, uint256 fee);
    event TransferAndCallPreSigned(address indexed from, address indexed to, address indexed delegate, uint256 amount, bytes data, uint256 fee);

    /**
     * @param _signature bytes The signature, issued by the owner.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _timestamp uint256 Timestamp of transaction, for uniqueness.
     */
    function transferPreSigned(bytes _signature, address _to, uint256 _value, uint256 _fee, uint256 _timestamp) public returns (bool);

    /**
     * @param _signature bytes The signature, issued by the owner.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _data bytes The data which enables the pass additional params.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _timestamp uint256 Timestamp of transaction, for uniqueness.
     */
    function transferAndCallPreSigned(bytes _signature, address _to, uint256 _value, bytes _data, uint256 _fee, uint256 _timestamp) public returns (bool);

    /**
     * @param _token address The address of the token.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _timestamp uint256 Timestamp of transaction, for uniqueness.
     */
    function getTransferPreSignedHash(address _token, address _to, uint256 _value, uint256 _fee, uint256 _timestamp) public pure returns (bytes32);

    /**
     * @param _token address The address of the token.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _data bytes The data which enables the pass additional params
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     * @param _timestamp uint256 Timestamp of transaction, for uniqueness.
     */
    function getTransferAndCallPreSignedHash(address _token, address _to, uint256 _value, bytes _data, uint256 _fee, uint256 _timestamp) public pure returns (bytes32);
}
