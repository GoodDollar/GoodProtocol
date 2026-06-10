# Invite bounties guide

Use when the task is to verify or execute inviter-invitee bounty payout flow and explain why payout is blocked.

## Goal

Check eligibility deterministically, execute payout only when eligible, and return exact failure reason when not eligible.

## Required inputs

- target chain
- `InvitesV2` address
- `Identity` address
- optional `UBISchemeV2` address when claims threshold is active
- invitee address
- inviter address
- rpc url and signer

## Execution flow

1. Resolve contract addresses from `deployment.json`.
2. Read invitee state from `users(invitee)` and global thresholds (`minimumClaims`, `minimumDays`, `active`).
3. Check current eligibility with `canCollectBountyFor(invitee)`.
4. If not eligible, read identity whitelist for invitee and inviter and return concrete blocker.
5. If eligible, execute `bountyFor(invitee)` or `collectBounties()` and return tx hash plus payout values from events.

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const invites = new ethers.Contract(
  process.env.INVITES_ADDRESS,
  [
    "function canCollectBountyFor(address) view returns (bool)",
    "function bountyFor(address)",
    "function users(address) view returns (bytes32,address,uint40,uint24,bool,uint256)",
    "function minimumClaims() view returns (uint256)",
    "function minimumDays() view returns (uint256)",
    "function active() view returns (bool)",
    "event InviterBounty(address indexed inviter,address indexed invitee,uint256 bountyPaid,uint256 inviterLevel,bool earnedLevel)"
  ],
  signer,
);

const identity = new ethers.Contract(
  process.env.IDENTITY_ADDRESS,
  [
    "function isWhitelisted(address) view returns (bool)"
  ],
  provider,
);

const invitee = process.env.INVITEE_ADDRESS;
const inviter = process.env.INVITER_ADDRESS;

const [isActive, eligible, inviteeWhitelisted, inviterWhitelisted, minClaims, minDays] = await Promise.all([
  invites.active(),
  invites.canCollectBountyFor(invitee),
  identity.isWhitelisted(invitee),
  identity.isWhitelisted(inviter),
  invites.minimumClaims(),
  invites.minimumDays(),
]);

if (!isActive) throw new Error("Invites contract is inactive");
if (!eligible) {
  throw new Error(
    `Not eligible. inviteeWhitelisted=${inviteeWhitelisted} inviterWhitelisted=${inviterWhitelisted} minimumClaims=${minClaims} minimumDays=${minDays}`,
  );
}

const tx = await invites.bountyFor(invitee);
const receipt = await tx.wait();
const bountyEvent = receipt.logs
  .map((log) => {
    try {
      return invites.interface.parseLog(log);
    } catch {
      return null;
    }
  })
  .find((e) => e && e.name === "InviterBounty");

console.log(
  JSON.stringify(
    {
      txHash: receipt.hash,
      invitee,
      inviter,
      bountyPaid: bountyEvent?.args?.bountyPaid?.toString() ?? null,
    },
    null,
    2,
  ),
);
```

## Failure handling

- invitee or inviter is not currently whitelisted
- reverification is due and whitelist check fails until re-authentication
- minimum claims or minimum days is not met
- bounty already paid or bounty-at-join is zero
- contract inactive or wrong deployment addresses

## Output contract

- network and addresses used
- eligibility status and blockers
- tx hash when sent
- payout values when available from logs
