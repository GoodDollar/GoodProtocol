# Inviter and invitee reward model

This explains why invite rewards sometimes work and sometimes fail, in user-facing terms.

Invite rewards are handled by `InvitesV2`, but eligibility depends heavily on the identity system (`Identity`, often `IdentityV4`). In practice, most confusing cases are caused by whitelist or reverification state, not by the invite contract itself.

## How the reward model works

There are two separate moments:

- `join`: the invitee registers with an invite code.
- bounty payout: the contract later checks if this invitee is eligible and pays inviter and invitee when rules pass.

So joining does not guarantee immediate payout. Payout depends on current eligibility at claim time.

## Why whitelist status is the main gate

For bounty eligibility, `InvitesV2` checks whitelist state through Identity.

The important behavior is:

- A user can still have status `1` in identity storage but fail `isWhitelisted(...)` if reverification is due.
- When reverification is due, bounty checks fail until an admin refreshes authentication(Face Verification).
- Connected-wallet setups can still fail if the specific address used in invite flow does not pass the whitelist check expected by the contract path.

## Why reverification blocks rewards

Reverification cadence is defined in `IdentityV4` with day-based options (`reverifyDaysOptions`) and per-user progression (`authCount`).

When too many days pass since the last authentication for that user’s current step:

- `shouldReverify(...)` becomes true
- `isWhitelisted(...)` becomes false for bounty gating
- `canCollectBountyFor(...)` fails until authentication is refreshed

This is why teams may see users who were once valid but are currently not eligible for invite rewards.

## Common reasons a bounty is not paid

- Invitee or inviter is not currently whitelisted.
- Reverification is due for invitee or inviter.
- `minimumClaims` or `minimumDays` thresholds are not met yet.
- Bounty was already paid or was zero at join time.
- Contract is inactive, or identity-chain checks do not match the active chain.
- Invite code or join state is invalid (duplicate code, self-invite, already joined).

## What to measure for analytics

- Historical pass: account was authenticated at least once (`lastAuthenticated > 0`).
- Current eligibility: account is currently whitelist-valid (`isWhitelisted`/non-zero root, depending on query design).

Do not treat these as the same metric. Historical pass explains past onboarding success; current eligibility explains current payout success.

## Contract sources

- Invite contract: [`InvitesV2.sol`](https://github.com/GoodDollar/GoodProtocol/blob/master/contracts/invite/InvitesV2.sol)
- Identity contract: [`IdentityV4.sol`](https://github.com/GoodDollar/GoodProtocol/blob/master/contracts/identity/IdentityV4.sol)
- Deployment addresses: [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json)
