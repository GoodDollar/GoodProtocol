# GoodProtocol

[![Actions Status](https://github.com/GoodDollar/GoodProtocol/workflows/CI/badge.svg)](https://github.com/GoodDollar/GoodProtocol/actions)
[![Coverage Status](https://coveralls.io/repos/github/GoodDollar/GoodProtocol/badge.svg?branch=master)](https://coveralls.io/github/GoodDollar/GoodProtocol?branch=master)
[![npm version](https://badge.fury.io/js/@gooddollar%2Fgoodprotocol.svg)](https://badge.fury.io/js/@gooddollar%2Fgoodprotocol)

Version 2 of GoodDollar smart contracts

# SuperGoodDollar

_SuperGoodDollar_ is an implementation of the GoodDollar token which adds functionality implemented by the Superfluid protocol, making it a _Super Token_.  

SuperGoodDollar is implemented as a [Pure Super Token](https://github.com/superfluid-finance/protocol-monorepo/wiki/About-Super-Token-Classification) - it has no underlying ERC20.  
This is possible because Super Tokens are themselves ERC20 tokens.

The SuperGoodDollar contract is composed like this:
**GoodDollarProxy** is a minimal base contract. It's responsible for state storage and for dispatching calls to the appropriate logic contract via delegatecall.
Its `initialize` method connects the proxy to 2 logic contracts:
1. the canonical **SuperToken** logic of the Superfluid framework
2. the logic specific for the GoodDollar token (**GoodDollarCustom**)
The proxy's `initialize` then invokes the initializer methods of both connected logic contracts.
The contract `GoodDollarCustom` overrides some of the method already implemented by the `SuperToken` contract.
Such overriding across different logic contracts can be done by making external calls to the base implementation.
For convenience, this is handled by the base contract `SuperTokenBase` which wraps SuperToken methods to be overrided.

Dual upgradeability of the 2 connected logic contracts is achieved this way:
1. upgrades of the SuperToken logic are handled by Superfluid governance, as is the case for other SuperTokens
2. upgrades of the GoodDollar logic is handled by the configured owner(s). The interface is the same (UUPSProxy), but with changed method names in order to avoid naming clashes. See example test case.

The tests in `SuperGoodDollar.ts` aren't comprehensive (not ready for production), but sufficient to prove that the mechanism with 2 logic contracts works.