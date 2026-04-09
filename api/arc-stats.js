// api/arc-stats.js
// Public endpoint — returns live Arc Testnet stats
// Register this in ArcPort marketplace as a demo custom API
// No auth required — free to call, $0.001 USDC via ArcPort

import { ethers } from 'ethers';

const ARC_RPC      = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC, {
      chainId: ARC_CHAIN_ID,
      name: 'arc-testnet',
    });

    // Fetch in parallel
    const [blockNumber, gasPrice, network, usdcSupply] = await Promise.all([
      provider.getBlockNumber(),
      provider.getFeeData(),
      provider.getNetwork(),
      new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider).totalSupply(),
    ]);

    // Latest block details
    const block = await provider.getBlock(blockNumber);

    return res.status(200).json({
      network:         'Arc Testnet',
      chain_id:        Number(network.chainId),
      block_number:    blockNumber,
      block_timestamp: block ? new Date(block.timestamp * 1000).toISOString() : null,
      block_tx_count:  block ? block.transactions.length : null,
      gas_price_gwei:  gasPrice.gasPrice
        ? parseFloat(ethers.formatUnits(gasPrice.gasPrice, 'gwei')).toFixed(6)
        : null,
      usdc_supply:     parseFloat(ethers.formatUnits(usdcSupply, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
      usdc_contract:   USDC_ADDRESS,
      explorer:        `https://testnet.arcscan.app/block/${blockNumber}`,
      fetched_at:      new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
