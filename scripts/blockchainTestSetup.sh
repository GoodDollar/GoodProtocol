#!/bin/bash
mkdir /tmp/goodprotocol
cp -R node_modules/@gooddollar/goodprotocol /tmp/goodprotocol
pushd /tmp/goodprotocol
export CI=false
export MNEMONIC='test test test test test test test test test test test junk'
export ADMIN_MNEMONIC='test test test test test test test test test test test junk'
yarn set version 3.6.0
echo "nodeLinker: node-modules" >> .yarnrc.yml
yarn
npx patch-package
yarn runNode &
sleep 30
yarn deployTest
yarn minimize
popd
cp -R /tmp/goodprotocol/artifacts node_modules/@gooddollar/goodprotocol/
cp -R /tmp/goodprotocol/releases node_modules/@gooddollar/goodprotocol/
