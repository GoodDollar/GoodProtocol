# GoodDaoHouses MVP implementation plan

This document captures the maintainer-reviewable MVP outline requested in GoodDollar/GoodProtocol#297 without introducing the contract yet.

## Contract placement and protocol wiring

- Add `GoodDaoHouses.sol` under `contracts/governance/`.
- Make it upgradeable with `DAOUpgradeableContract` so avatar-authorized upgrades follow the existing governance pattern.
- Resolve protocol dependencies through `NameService`, including the `GOODDOLLAR` token and any execution-time configuration that should remain DAO-managed.
- Keep the MVP as a single contract with internal structs and enums for:
  - house membership state
  - HoA eligibility state
  - vote snapshots
  - per-voter ballots
  - finalized allocations
  - FlowSplitter pool configuration and execution state

## Existing repository patterns to reuse

- Reuse `DAOUpgradeableContract` + `NameService` lookup for DAO wiring and upgrades.
- Reuse OpenZeppelin role patterns already present in governance contracts for admin and committee permissions.
- Reuse the explicit vote lifecycle pattern from `CompoundVotingMachine.sol`: manual creation, stored start and end boundaries, and fixed eligibility at vote creation time.
- Reuse the ERC677 `transferAndCall` staking flow from `GoodDollarStaking.sol` as the preferred one-transaction membership path.

## Membership model

- Model the two houses as:
  - `enum House { Citizens, Alignment }`
  - `enum MemberStatus { None, Pending, Active, Revoked, Unstaked }`
- Store per-member state with:
  - selected house
  - current status
  - staked amount
  - `joinedAt`
  - `updatedAt`
  - `unstakedAt`
  - plain-string metadata fields needed by each house
- Store HoA eligibility separately with:
  - `isEligible`
  - `listedAt`
  - `updatedAt`
  - optional delist timestamp
- HoC membership can activate immediately once the minimum stake is met.
- HoA registration should remain gated by committee-managed eligibility and enter `Pending` until approved.
- Revocation and unstake should preserve history through timestamps and events instead of deleting prior participation data.

## Staking and registration flow

- Primary MVP path: `GoodDollar.transferAndCall(housesContract, amount, encodedRegistrationData)`.
- `onTokenTransfer` should decode the selected house and metadata, then perform register-and-stake atomically.
- Keep direct `registerAndStake` or `stake` helpers only if needed for operational flexibility, but treat ERC677 as the main path.
- Minimum stake should be configurable per house by the governance committee role.
- Unstaking should fully clear HoA approval state and produce any required downstream zero-allocation execution updates.

## Permission model

- `DEFAULT_ADMIN_ROLE` should cover emergency administration such as pause and role management.
- The MVP should use a single `GOVERNANCE_COMMITTEE_ROLE` for:
  - HoA eligibility management
  - HoA approval and revocation
  - vote creation
  - vote finalization
  - vote execution
  - stake configuration updates
- Apply pause protection on sensitive write paths only:
  - registration
  - approval and revocation
  - unstake
  - vote creation
  - vote updates
  - finalization
  - execution
  - FlowSplitter configuration writes

## Alignment vote model

- Implement a single committee-created `AlignmentVote` type for the quarterly cycle.
- On vote creation, snapshot:
  - active HoA recipients
  - active HoA voters
  - active HoC voters
  - fixed per-house vote weights of `40` for HoA and `4` for HoC
  - explicit open and close timestamps, with a seven-day default
- Ballots should store each voter’s current allocation so the voter can replace the full allocation while the vote remains open.
- Finalization should compute and persist canonical on-chain results before any downstream execution attempt.
- Execution should stay as a separate permissioned action, one time per vote, and must not erase finalized results when downstream execution fails.

## Finalized allocation representation

- Finalization should persist a deterministic internal `recipient -> uint128 units` result for each vote.
- The contract should translate those finalized units into `IFlowSplitter.Member[]` only during execution.
- Allocation math should normalize every recipient against a configured `totalUnits` value so execution is deterministic across pool creation and later pool updates.

## FlowSplitter integration boundary

- Use the published `flow-state-coop/flow-splitter` `src/IFlowSplitter.sol` interface shape rather than a custom approximation.
- Plan around the pool-based integration surface:
  - `createPool(...)`
  - `updateMembersUnits(...)`
  - `updatePoolAdmins(...)`
  - `updatePoolMetadata(...)`
  - `isPoolAdmin(...)`
  - `getPoolById(...)`
- Mirror the external FlowSplitter structs exactly:
  - `Member { address account; uint128 units; }`
  - `Admin { address account; AdminStatus status; }`
  - `Pool { uint256 id; address poolAddress; address token; string metadata; bytes32 adminRole; }`
  - `PoolConfig { bool transferabilityForUnitsOwner; bool distributionFromAnyAddress; }`
  - `PoolERC20Metadata { string name; string symbol; uint8 decimals; }`
- Persist enough pool state to continue operating the same pool after first execution:
  - FlowSplitter contract address
  - configured Super Token address
  - pool id
  - pool address
  - pool metadata
  - initialization flag
- Register `GoodDaoHouses` itself as the acting pool admin so GovCo authorization remains enforced inside the governance contract instead of through rotating EOAs.
- Keep execution optional and configurable until the exact Celo Super Token and pool token choice is confirmed.
- Recommended MVP execution path:
  1. finalize vote allocations on-chain
  2. create the FlowSplitter pool on the first successful execution
  3. reuse `updateMembersUnits(...)` on later executions
  4. use `updatePoolMetadata(...)` when metadata changes
- Unstake or HoA approval removal should emit an explicit zero-unit member update for the affected recipient on the next relevant execution path.
- Recommended pool config for the governance-controlled MVP:
  - `transferabilityForUnitsOwner = false`
  - `distributionFromAnyAddress = false`

## Read and write surface

- Read methods should cover:
  - member records
  - HoA eligibility records
  - per-house stake requirements
  - active-member checks
  - vote configuration
  - vote snapshots
  - ballot state
  - finalized allocations
  - execution status
  - FlowSplitter configuration
  - pool id and pool address
- Write methods should cover:
  - add and remove HoA eligibility
  - ERC677 registration callback
  - HoA approval and revocation
  - unstake
  - create vote
  - cast or replace vote allocations
  - finalize vote
  - execute results
  - configure FlowSplitter
  - create the pool
  - sync pool metadata
  - pause and unpause

## Events

- Include events for:
  - HoA eligibility added and removed
  - member registered
  - member approved
  - member revoked
  - member unstaked
  - vote created
  - vote updated
  - vote finalized
  - vote executed
  - FlowSplitter configuration updated
  - FlowSplitter pool created

## Deployment and test expectations

- Follow the existing upgradeable governance deployment pattern and register the contract through `NameService`.
- Add governance tests under `test/governance/` using `createDAO()` fixtures and `loadFixture(...)`.
- Minimum test coverage for the implementation phase should include:
  - HoA eligibility gating
  - ERC677 register-and-stake flow
  - HoC immediate activation
  - HoA pending-to-active approval flow
  - revocation and unstake transitions
  - vote snapshot correctness
  - weighted vote replacement logic
  - finalize-before-execute guarantees
  - single-execution enforcement
  - failed-execution persistence
  - first execution pool creation
  - re-execution member unit updates
  - zero-unit updates after unstake or approval removal
  - role and pause enforcement
