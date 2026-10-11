// 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed
interface ICreateX {
	function deployCreate2(
		bytes32 salt,
		bytes memory bytecode
	) external payable returns (address);
}
