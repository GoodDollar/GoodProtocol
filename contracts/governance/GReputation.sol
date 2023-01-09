// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./Reputation.sol";
import "../Interfaces.sol";

/**
 * @title GReputation extends Reputation with delegation and cross blockchain merkle states
 * @dev NOTICE: this breaks DAOStack nativeReputation usage, since it is not possiible to upgrade
 * the original nativeReputation token. it means you can no longer rely on avatar.nativeReputation() or controller.nativeReputation()
 * to return the current reputation token.
 * The DAO avatar will be the owner of this reputation token and not the Controller.
 * Minting by the DAO will be done using controller.genericCall and not via controller.mintReputation
 *
 * V2 fixes merkle tree bug
 */
contract GReputation is Reputation {
	bytes32 public constant ROOT_STATE = keccak256("rootState");

	/// @notice The EIP-712 typehash for the contract's domain
	bytes32 public constant DOMAIN_TYPEHASH =
		keccak256(
			"EIP712Domain(string name,uint256 chainId,address verifyingContract)"
		);

	/// @notice The EIP-712 typehash for the delegation struct used by the contract
	bytes32 public constant DELEGATION_TYPEHASH =
		keccak256("Delegation(address delegate,uint256 nonce,uint256 expiry)");

	/// @notice describe a single blockchain states
	/// @param stateHash the hash with the reputation state
	/// @param hashType the type of hash. currently just 0 = merkle tree root hash
	/// @param totalSupply the totalSupply at the blockchain
	/// @param blockNumber the effective blocknumber
	struct BlockchainState {
		bytes32 stateHash;
		uint256 hashType;
		uint256 totalSupply;
		uint256 blockNumber;
		uint256[5] __reserevedSpace;
	}

	/// @notice A record of states for signing / validating signatures
	mapping(address => uint256) public nonces;

	/// @notice mapping from blockchain id hash to list of states
	mapping(bytes32 => BlockchainState[]) public blockchainStates;

	/// @notice mapping from stateHash to the user balance can be >0 only after supplying state proof
	mapping(bytes32 => mapping(address => uint256)) public stateHashBalances;

	/// @notice list of blockchains having a statehash for easy iteration
	bytes32[] public activeBlockchains;

	/// @notice keep map of user -> delegate
	mapping(address => address) public delegates;

	/// @notice map of user non delegated + delegated votes to user. this is used for actual voting
	mapping(address => uint256[]) public activeVotes;

	/// @notice keep map of address -> reputation recipient, an address can set that its earned rep will go to another address
	mapping(address => address) public reputationRecipients;

	/// @notice An event thats emitted when a delegate account's vote balance changes
	event DelegateVotesChanged(
		address indexed delegate,
		address indexed delegator,
		uint256 previousBalance,
		uint256 newBalance
	);

	event StateHash(string blockchain, bytes32 merkleRoot, uint256 totalSupply);

	event StateHashProof(
		string blockchain,
		address indexed user,
		uint256 repBalance
	);

	/**
	 * @dev initialize
	 */
	function initialize(
		INameService _ns,
		string calldata _stateId,
		bytes32 _stateHash,
		uint256 _totalSupply
	) external initializer {
		__Reputation_init(_ns);
		if (_totalSupply > 0)
			_setBlockchainStateHash(_stateId, _stateHash, _totalSupply);
	}

	function updateDAO(INameService _ns) public {
		if (address(nameService) == address(0)) {
			setDAO(_ns);
			_setupRole(DEFAULT_ADMIN_ROLE, address(avatar));
			_setupRole(MINTER_ROLE, address(avatar));
		}
	}

	function _canMint() internal view override {
		require(
			hasRole(MINTER_ROLE, _msgSender()) ||
				(address(nameService) != address(0) &&
					(_msgSender() == nameService.getAddress("GDAO_CLAIMERS") ||
						_msgSender() == nameService.getAddress("GDAO_STAKING") ||
						_msgSender() == nameService.getAddress("GDAO_STAKERS"))),
			"GReputation: need minter role or be GDAO contract"
		);
	}

	function _mint(address _user, uint256 _amount)
		internal
		override
		returns (uint256)
	{
		return _mint(_user, _amount, false);
	}

	/// @notice internal function that overrides Reputation.sol with consideration to delegation
	/// @param _user the address to mint for
	/// @param _amount the amount of rep to mint
	/// @return the actual amount minted
	function _mint(
		address _user,
		uint256 _amount,
		bool ignoreRepTarget
	) internal returns (uint256) {
		address repTarget = reputationRecipients[_user];
		repTarget = ignoreRepTarget == false && repTarget != address(0)
			? repTarget
			: _user;

		super._mint(repTarget, _amount);

		//set self as initial delegator
		address delegator = delegates[repTarget];
		if (delegator == address(0)) {
			delegates[repTarget] = repTarget;
			delegator = repTarget;
		}
		uint256 previousVotes = getVotesAt(delegator, false, block.number);

		_updateDelegateVotes(
			delegator,
			repTarget,
			previousVotes,
			previousVotes + _amount
		);
		return _amount;
	}

	/// @notice internal function that overrides Reputation.sol with consideration to delegation
	/// @param _user the address to burn from
	/// @param _amount the amount of rep to mint
	/// @return the actual amount burned
	function _burn(address _user, uint256 _amount)
		internal
		override
		returns (uint256)
	{
		uint256 amountBurned = super._burn(_user, _amount);
		address delegator = delegates[_user];
		delegator = delegator != address(0) ? delegator : _user;
		delegates[_user] = delegator;

		uint256 previousVotes = getVotesAt(delegator, false, block.number);

		_updateDelegateVotes(
			delegator,
			_user,
			previousVotes,
			previousVotes - amountBurned
		);

		return amountBurned;
	}

	/// @notice sets the state hash of a blockchain, can only be called by owner
	/// @param _id the string name of the blockchain (will be hashed to produce byte32 id)
	/// @param _hash the state hash
	/// @param _totalSupply total supply of reputation on the specific blockchain
	function setBlockchainStateHash(
		string memory _id,
		bytes32 _hash,
		uint256 _totalSupply
	) public {
		_onlyAvatar();
		_setBlockchainStateHash(_id, _hash, _totalSupply);
	}

	/// @notice sets the state hash of a blockchain, can only be called by owner
	/// @param _id the string name of the blockchain (will be hashed to produce byte32 id)
	/// @param _hash the state hash
	/// @param _totalSupply total supply of reputation on the specific blockchain
	function _setBlockchainStateHash(
		string memory _id,
		bytes32 _hash,
		uint256 _totalSupply
	) internal {
		bytes32 idHash = keccak256(bytes(_id));

		//dont consider rootState as blockchain,  it is a special state hash
		bool isRootState = idHash == ROOT_STATE;
		require(
			!isRootState || totalSupplyLocalAt(block.number) == 0,
			"rootState already created"
		);
		if (isRootState) {
			updateValueAtNow(totalSupplyHistory, _totalSupply);
		}
		uint256 i = 0;
		for (; !isRootState && i < activeBlockchains.length; i++) {
			if (activeBlockchains[i] == idHash) break;
		}

		//if new blockchain
		if (!isRootState && i == activeBlockchains.length) {
			activeBlockchains.push(idHash);
		}

		BlockchainState memory state;
		state.stateHash = _hash;
		state.totalSupply = _totalSupply;
		state.blockNumber = block.number;
		blockchainStates[idHash].push(state);

		emit StateHash(_id, _hash, _totalSupply);
	}

	/// @notice get the number of active votes a user holds after delegation (vs the basic balance of reputation he holds)
	/// @param _user the user to get active votes for
	/// @param _global wether to include reputation from other blockchains
	/// @param _blockNumber get votes state at specific block
	/// @return the number of votes
	function getVotesAt(
		address _user,
		bool _global,
		uint256 _blockNumber
	) public view returns (uint256) {
		uint256 startingBalance = getValueAt(activeVotes[_user], _blockNumber);

		if (_global) {
			for (uint256 i = 0; i < activeBlockchains.length; i++) {
				startingBalance += getVotesAtBlockchain(
					activeBlockchains[i],
					_user,
					_blockNumber
				);
			}
		}

		return startingBalance;
	}

	/**
	 * @notice returns aggregated active votes in all blockchains and delegated
	 * @param _user the user to get active votes for
	 * @return the number of votes
	 */
	function getVotes(address _user) public view returns (uint256) {
		return getVotesAt(_user, true, block.number);
	}

	/**
	 * @notice same as getVotes, be compatible with metamask
	 */
	function balanceOf(address _user) public view returns (uint256 balance) {
		return getVotesAt(_user, block.number);
	}

	/**
	 same as getVotes be compatible with compound 
	 */
	function getCurrentVotes(address _user) public view returns (uint256) {
		return getVotesAt(_user, true, block.number);
	}

	function getPriorVotes(address _user, uint256 _block)
		public
		view
		returns (uint256)
	{
		return getVotesAt(_user, true, _block);
	}

	/**
	 * @notice returns aggregated active votes in all blockchains and delegated at specific block
	 * @param _user user to get active votes for
	 * @param _blockNumber get votes state at specific block
	 * @return the number of votes
	 */
	function getVotesAt(address _user, uint256 _blockNumber)
		public
		view
		returns (uint256)
	{
		return getVotesAt(_user, true, _blockNumber);
	}

	/**
	 * @notice returns total supply in current blockchain
	 * @param _blockNumber get total supply at specific block
	 * @return the totaly supply
	 */
	function totalSupplyLocal(uint256 _blockNumber)
		public
		view
		returns (uint256)
	{
		return totalSupplyLocalAt(_blockNumber);
	}

	/**
	 * @notice returns total supply in all blockchain aggregated
	 * @param _blockNumber get total supply at specific block
	 * @return the totaly supply
	 */
	function totalSupplyAt(uint256 _blockNumber) public view returns (uint256) {
		uint256 startingSupply = totalSupplyLocalAt(_blockNumber);
		for (uint256 i = 0; i < activeBlockchains.length; i++) {
			startingSupply += totalSupplyAtBlockchain(
				activeBlockchains[i],
				_blockNumber
			);
		}
		return startingSupply;
	}

	/// @dev This function makes it easy to get the total number of reputation
	/// @return The total number of reputation
	function totalSupply() public view returns (uint256) {
		return totalSupplyAt(block.number);
	}

	/// @notice get the number of active votes a user holds after delegation in specific blockchain
	/// @param _id the keccak hash of the blockchain string id
	/// @param _user the user to get active votes for
	/// @param _blockNumber get votes state at specific block
	/// @return the number of votes
	function getVotesAtBlockchain(
		bytes32 _id,
		address _user,
		uint256 _blockNumber
	) public view returns (uint256) {
		BlockchainState[] storage states = blockchainStates[_id];
		int256 i = int256(states.length);

		if (i == 0) return 0;
		BlockchainState storage state = states[uint256(i - 1)];
		for (i = i - 1; i >= 0; i--) {
			if (state.blockNumber <= _blockNumber) break;
			state = states[uint256(i - 1)];
		}
		if (i < 0) return 0;

		return stateHashBalances[state.stateHash][_user];
	}

	/**
	 * @notice returns total supply in a specific blockchain
	 * @param _blockNumber get total supply at specific block
	 * @return the totaly supply
	 */
	function totalSupplyAtBlockchain(bytes32 _id, uint256 _blockNumber)
		public
		view
		returns (uint256)
	{
		BlockchainState[] storage states = blockchainStates[_id];
		int256 i;
		if (states.length == 0) return 0;
		for (i = int256(states.length - 1); i >= 0; i--) {
			if (states[uint256(i)].blockNumber <= _blockNumber) break;
		}
		if (i < 0) return 0;

		BlockchainState storage state = states[uint256(i)];
		return state.totalSupply;
	}

	/**
	 * @notice prove user balance in a specific blockchain state hash, uses new sorted pairs trees and double hash for preimage attack mitigation
	 * @dev "rootState" is a special state that can be supplied once, and actually mints reputation on the current blockchain
	 * we use non sorted merkle tree, as sorting while preparing merkle tree is heavy
	 * @param _id the string id of the blockchain we supply proof for
	 * @param _user the user to prove his balance
	 * @param _balance the balance we are prooving
	 * @param _proof array of byte32 with proof data (currently merkle tree path)
	 * @return true if proof is valid
	 */
	function proveBalanceOfAtBlockchain(
		string memory _id,
		address _user,
		uint256 _balance,
		bytes32[] memory _proof
	) public returns (bool) {
		return
			_proveBalanceOfAtBlockchain(
				_id,
				_user,
				_balance,
				_proof,
				new bool[](0),
				0,
				false
			);
	}

	/**
	 * DEPRECATED: future state hashes will be with sorted pairs and with double hash leaf values
	 * @notice prove user balance in a specific blockchain state hash
	 * @dev "rootState" is a special state that can be supplied once, and actually mints reputation on the current blockchain
	 * we use non sorted merkle tree, as sorting while preparing merkle tree is heavy
	 * @param _id the string id of the blockchain we supply proof for
	 * @param _user the user to prove his balance
	 * @param _balance the balance we are prooving
	 * @param _proof array of byte32 with proof data (currently merkle tree path)
	 * @param _isRightNode array of bool with indication if should be hashed on right or left
	 * @param _nodeIndex index of node in the tree (for unsorted merkle tree proof)
	 * @return true if proof is valid
	 */
	function proveBalanceOfAtBlockchainLegacy(
		string memory _id,
		address _user,
		uint256 _balance,
		bytes32[] memory _proof,
		bool[] memory _isRightNode,
		uint256 _nodeIndex
	) public returns (bool) {
		return
			_proveBalanceOfAtBlockchain(
				_id,
				_user,
				_balance,
				_proof,
				_isRightNode,
				_nodeIndex,
				true
			);
	}

	function _proveBalanceOfAtBlockchain(
		string memory _id,
		address _user,
		uint256 _balance,
		bytes32[] memory _proof,
		bool[] memory _isRightNode,
		uint256 _nodeIndex,
		bool legacy
	) internal returns (bool) {
		bytes32 idHash = keccak256(bytes(_id));
		require(
			blockchainStates[idHash].length > 0,
			"no state found for given _id"
		);
		bytes32 stateHash = blockchainStates[idHash][
			blockchainStates[idHash].length - 1
		].stateHash;

		//this is specifically important for rootState that should update real balance only once
		require(
			stateHashBalances[stateHash][_user] == 0,
			"stateHash already proved"
		);

		bytes32 leafHash = keccak256(abi.encode(_user, _balance));
		//v2 double hash fix to prevent preimage attack
		if (legacy == false) {
			leafHash = keccak256(abi.encode(leafHash));
		}
		bool isProofValid = checkProofOrdered(
			_proof,
			_isRightNode,
			stateHash,
			leafHash,
			_nodeIndex,
			legacy == false
		);

		require(isProofValid, "invalid merkle proof");

		//if initiial state then set real balance
		if (idHash == ROOT_STATE) {
			uint256 curTotalSupply = totalSupplyLocalAt(block.number);
			// on proof for ROOT_HASH we force to ignore the repTarget, so it is the same wallet address receiving the reputation (prevent double voting power on snapshot)
			// also it should behave the same as blockchain sync proof which also doesnt use repTarget, but updates the same address as in the proof
			_mint(_user, _balance, true);

			updateValueAtNow(totalSupplyHistory, curTotalSupply); // we undo the totalsupply, as we alredy set the totalsupply of the airdrop
		}

		//if proof is valid then set balances
		stateHashBalances[stateHash][_user] = _balance;

		emit StateHashProof(_id, _user, _balance);
		return true;
	}

	/// @notice returns current delegate of _user
	/// @param _user the delegatee
	/// @return the address of the delegate (can be _user  if no delegate or 0x0 if _user doesnt exists)
	function delegateOf(address _user) public view returns (address) {
		return delegates[_user];
	}

	/// @notice delegate votes to another user
	/// @param _delegate the recipient of votes
	function delegateTo(address _delegate) public {
		return _delegateTo(_msgSender(), _delegate);
	}

	/// @notice cancel user delegation
	/// @dev makes user his own delegate
	function undelegate() public {
		return _delegateTo(_msgSender(), _msgSender());
	}

	/**
	 * @notice Delegates votes from signatory to `delegate`
	 * @param _delegate The address to delegate votes to
	 * @param _nonce The contract state required to match the signature
	 * @param _expiry The time at which to expire the signature
	 * @param _v The recovery byte of the signature
	 * @param _r Half of the ECDSA signature pair
	 * @param _s Half of the ECDSA signature pair
	 */
	function delegateBySig(
		address _delegate,
		uint256 _nonce,
		uint256 _expiry,
		uint8 _v,
		bytes32 _r,
		bytes32 _s
	) public {
		bytes32 domainSeparator = keccak256(
			abi.encode(
				DOMAIN_TYPEHASH,
				keccak256(bytes(name)),
				getChainId(),
				address(this)
			)
		);
		bytes32 structHash = keccak256(
			abi.encode(DELEGATION_TYPEHASH, _delegate, _nonce, _expiry)
		);
		bytes32 digest = keccak256(
			abi.encodePacked("\x19\x01", domainSeparator, structHash)
		);
		address signatory = ecrecover(digest, _v, _r, _s);
		require(
			signatory != address(0),
			"GReputation::delegateBySig: invalid signature"
		);
		require(
			_nonce == nonces[signatory]++,
			"GReputation::delegateBySig: invalid nonce"
		);
		require(
			block.timestamp <= _expiry,
			"GReputation::delegateBySig: signature expired"
		);
		return _delegateTo(signatory, _delegate);
	}

	/// @notice internal function to delegate votes to another user
	/// @param _user the source of votes (delegator)
	/// @param _delegate the recipient of votes
	function _delegateTo(address _user, address _delegate) internal {
		require(
			_delegate != address(0),
			"GReputation::delegate can't delegate to null address"
		);

		address curDelegator = delegates[_user];
		require(curDelegator != _delegate, "already delegating to delegator");

		delegates[_user] = _delegate;

		// remove votes from current delegator
		uint256 coreBalance = balanceOfLocalAt(_user, block.number);
		//redundant check - should not be possible to have address 0 as delegator
		if (curDelegator != address(0)) {
			uint256 removeVotes = getVotesAt(curDelegator, false, block.number);
			_updateDelegateVotes(
				curDelegator,
				_user,
				removeVotes,
				removeVotes - coreBalance
			);
		}

		//move votes to new delegator
		uint256 addVotes = getVotesAt(_delegate, false, block.number);
		_updateDelegateVotes(_delegate, _user, addVotes, addVotes + coreBalance);
	}

	/// @notice internal function to update delegated votes, emits event with changes
	/// @param _delegate the delegate whose record we are updating
	/// @param _delegator the delegator
	/// @param _oldVotes the delegate previous votes
	/// @param _newVotes the delegate votes after the change
	function _updateDelegateVotes(
		address _delegate,
		address _delegator,
		uint256 _oldVotes,
		uint256 _newVotes
	) internal {
		updateValueAtNow(activeVotes[_delegate], _newVotes);
		emit DelegateVotesChanged(_delegate, _delegator, _oldVotes, _newVotes);
	}

	// from StorJ -- https://github.com/nginnever/storj-audit-verifier/blob/master/contracts/MerkleVerifyv3.sol
	/**
	 * @dev non sorted merkle tree proof check
	 */
	function checkProofOrdered(
		bytes32[] memory _proof,
		bool[] memory _isRightNode,
		bytes32 _root,
		bytes32 _hash,
		uint256 _index,
		bool sorted
	) public pure returns (bool) {
		// use the index to determine the node ordering
		// index ranges 1 to n

		bytes32 proofElement;
		bytes32 computedHash = _hash;
		uint256 remaining;

		for (uint256 j = 0; j < _proof.length; j++) {
			proofElement = _proof[j];

			// for new sorted format
			if (sorted) {
				computedHash = proofElement < computedHash
					? keccak256(abi.encodePacked(proofElement, computedHash))
					: keccak256(abi.encodePacked(computedHash, proofElement));
				continue;
			}

			// start of legacy format for the first GOOD airdrop

			// calculate remaining elements in proof
			remaining = _proof.length - j;

			// we don't assume that the tree is padded to a power of 2
			// if the index is odd then the proof will start with a hash at a higher
			// layer, so we have to adjust the index to be the index at that layer
			while (remaining > 0 && _index % 2 == 1 && _index > 2**remaining) {
				_index = _index / 2 + 1;
			}

			if (
				(_isRightNode.length > 0 && _isRightNode[j] == false) ||
				(_isRightNode.length == 0 && _index % 2 == 0)
			) {
				computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
				_index = _index / 2;
			} else {
				computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
				_index = _index / 2 + 1;
			}
		}

		return computedHash == _root;
	}

	/// @notice helper function to get current chain id
	/// @return chain id
	function getChainId() internal view returns (uint256) {
		uint256 chainId;
		assembly {
			chainId := chainid()
		}
		return chainId;
	}

	function setReputationRecipient(address _target) public {
		reputationRecipients[msg.sender] = _target;
	}
}
