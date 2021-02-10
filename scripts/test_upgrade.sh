#!/usr/bin/env bash

DEPLOYED_VERSION=$(cat $GITHUB_WORKSPACE/DEPLOYED)
DEPLOYED_DIR=$GITHUB_WORKSPACE/deployed-skale-manager/

git clone --branch $DEPLOYED_VERSION https://github.com/$GITHUB_REPOSITORY.git $DEPLOYED_DIR

npx ganache-cli --gasLimit 8000000 --quiet &
GANACHE_PID=$!

# TODO:
# It is not a complete check!

mv contracts contracts_new || exit $?
cp -r $DEPLOYED_DIR/contracts ./ || exit $?

PRODUCTION=true npx hardhat run migrations/deploy.ts --network localhost || exit $?

rm -r contracts || exit $?
mv contracts_new contracts || exit $?

ABI=data/skale-manager-$(cat $GITHUB_WORKSPACE/VERSION)-localhost-abi.json npx hardhat run migrations/upgrade.ts --network localhost || exit $?

# cd $DEPLOYED_DIR
# yarn install || exit $?
# npx oz push --network test --force || exit $?
# NODE_OPTIONS="--max-old-space-size=4096" PRODUCTION=true npx truffle migrate --network test || exit $?
# rm $GITHUB_WORKSPACE/.openzeppelin/dev-*.json
# cp .openzeppelin/dev-*.json $GITHUB_WORKSPACE/.openzeppelin || exit $?
# cp .openzeppelin/project.json $GITHUB_WORKSPACE/.openzeppelin || exit $?
# cp data/test.json $GITHUB_WORKSPACE/data || exit $?
# cd $GITHUB_WORKSPACE
# rm -r --interactive=never $DEPLOYED_DIR

# NETWORK_ID=$(ls -a .openzeppelin | grep dev | cut -d '-' -f 2 | cut -d '.' -f 1)
# CHAIN_ID=1337

# mv .openzeppelin/dev-$NETWORK_ID.json .openzeppelin/mainnet.json || exit $?

# npx migrate-oz-cli-project || exit $?
# mv .openzeppelin/mainnet.json .openzeppelin/unknown-$CHAIN_ID.json || exit $?

# ABI=data/test.json npx hardhat run migrations/upgrade.ts --network localhost || exit $?

kill $GANACHE_PID
