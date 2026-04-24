#!/usr/bin/env node
/**
 * deploy.mjs — Deploy ArcStreamChannel to Arc Testnet.
 *
 * Usage:
 *   ARC_PRIVATE_KEY=0x... PLATFORM_ARC_ADDRESS=0x... node contracts/deploy.mjs
 *
 * Requirements:
 *   - ethers dependency installed
 *   - solc available in PATH (`npm i -g solc`) or deploy through Remix manually
 */

import { execSync } from 'node:child_process';
import { ethers } from 'ethers';

const ARC_RPC = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const CONTRACT_PATH = 'contracts/ArcStreamChannel.sol';

const PLATFORM_ADDRESS = process.env.PLATFORM_ARC_ADDRESS;
const PRIVATE_KEY = process.env.ARC_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('ARC_PRIVATE_KEY required');
  process.exit(1);
}
if (!PLATFORM_ADDRESS) {
  console.error('PLATFORM_ARC_ADDRESS required');
  process.exit(1);
}

function compileContract() {
  let output;
  try {
    output = execSync(`solc --combined-json abi,bin --optimize ${CONTRACT_PATH}`, { encoding: 'utf8' });
  } catch (err) {
    console.error('solc compile failed. Install solc globally or deploy via Remix.');
    console.error('Suggested: npm install -g solc');
    process.exit(1);
  }

  const parsed = JSON.parse(output);
  const contractKey = Object.keys(parsed.contracts || {}).find(key => key.endsWith(':ArcStreamChannel'));
  const artifact = contractKey ? parsed.contracts[contractKey] : null;

  if (!artifact?.bin || !artifact?.abi) {
    console.error('Could not parse solc output for ArcStreamChannel bytecode/abi');
    process.exit(1);
  }

  return { bytecode: `0x${artifact.bin}`, abi: artifact.abi };
}

async function main() {
  const { bytecode, abi } = compileContract();
  const provider = new ethers.JsonRpcProvider(
    ARC_RPC,
    { chainId: ARC_CHAIN_ID, name: 'arc-testnet' },
    { staticNetwork: true }
  );
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Deploying ArcStreamChannel from ${wallet.address}`);
  console.log(`USDC:     ${USDC_ADDRESS}`);
  console.log(`Platform: ${PLATFORM_ADDRESS}`);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(USDC_ADDRESS, PLATFORM_ADDRESS);

  console.log(`Deploy tx: ${contract.deploymentTransaction().hash}`);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nArcStreamChannel deployed at: ${address}`);
  console.log(`Explorer: https://testnet.arcscan.app/address/${address}`);
  console.log(`\nSet env:`);
  console.log(`SESSION_CHANNEL_CONTRACT=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
