module.exports = {
  providerOptions: {
    mnemonic:
      "glad notable bullet donkey fall dolphin simple size stone evil slogan dinner",
    default_balance_ether: 1000000
  },
  istanbulReporter: ["html", "lcov", "text"],
  skipFiles: [
    "mocks",
    "DAOStackInterfaces.sol",
    "Interfaces.sol",
    "token/ERC20PresetMinterPauserUpgradeable.sol",
    "staking/utils/Math64X64.sol",
    "staking/BaseShareField.sol",
    "staking/SimpleStaking.sol",
    "staking/aave/GoodAaveStaking.sol",
    "staking/compound/GoodCompoundStaking.sol",
    "utils/ReputationTestHelper.sol",
    "utils/BancorFormula.sol",
    "utils/DSMath.sol",
    "utils/MultiCall.sol",
    "utils/ProtocolUpgradeRecover.sol",
    "utils/ProtocolUpgradeFuseRecover.sol",
    "utils/BulkProof.sol",
    "utils/DataTypes.sol"
  ],
  mocha: {
    grep: "@skip-on-coverage", // Find everything with this tag
    invert: true, // Run the grep's inverse set.
    enableTimeouts: false,
    timeout: 3600000
  }
};
