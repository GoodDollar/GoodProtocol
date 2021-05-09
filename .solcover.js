module.exports = {
  providerOptions: {
    mnemonic:
      "glad notable bullet donkey fall dolphin simple size stone evil slogan dinner",
    default_balance_ether: 1000000
  },
  istanbulReporter: ["html", "lcov"],
  skipFiles: [
    "utils/ReputationTestHelper.sol",
    "mocks/cDAIMock.sol",
    "mocks/cDAILowWorthMock.sol",
    "mocks/cDAINonMintableMock.sol",
    "mocks/DAIMock.sol",
    "utils/BancorFormula.sol",
    "utils/DSMath.sol"
  ],
  mocha: {
    grep: "@skip-on-coverage", // Find everything with this tag
    invert: true, // Run the grep's inverse set.
    enableTimeouts: false,
    timeout: 3600000
  }
};
