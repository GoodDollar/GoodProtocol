#run with source .env && ./scripts/multichain-deploy/fulldeploy.sh
NETWORK=$1
npx hardhat run ./scripts/multichain-deploy/0_proxyFactory-deploy.ts --network $NETWORK
if [ $? != 0 ]; then
    exit 1;
fi
npx hardhat run ./scripts/multichain-deploy/1_basicdao-deploy.ts --network $NETWORK
if [ $? != 0 ]; then
    exit 1;
fi
npx hardhat run ./scripts/multichain-deploy/2_helpers-deploy.ts --network $NETWORK
if [ $? != 0 ]; then
    exit 1;
fi
npx hardhat run ./scripts/multichain-deploy/3_gdSavings-deploy.ts --network $NETWORK
if [ $? != 0 ]; then
    exit 1;
fi
npx hardhat run ./scripts/multichain-deploy/4_ubi-deploy.ts --network $NETWORK
if [ $? != 0 ]; then
    exit 1;
fi
npx hardhat run ./scripts/multichain-deploy/5_gov-deploy.ts --network $NETWORK
if [ $? != 0 ]; then
    exit 1;
fi