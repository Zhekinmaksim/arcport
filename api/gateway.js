import { parseUnits } from 'ethers';

import {
  createContractExecution,
  getGatewayBalances,
  waitForDeveloperTransaction,
} from './_circle.js';
import { resolveWalletByToken } from './_wallet-identity.js';
import {
  ARC_DOMAIN,
  GATEWAY_WALLET_CONTRACT,
  USDC_ADDRESS,
} from './_arcport-payment.js';

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet = (table, filter) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());

async function loadGatewayBalance(address) {
  const balances = await getGatewayBalances({ depositor: address, domain: ARC_DOMAIN });
  const row = balances.find(item => String(item.domain) === String(ARC_DOMAIN) && item.depositor?.toLowerCase() === address.toLowerCase());
  return row ? Number(row.balance) : 0;
}

async function waitForGatewayBalance(address, previousBalance, { timeoutMs = 60000, intervalMs = 3000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const balance = await loadGatewayBalance(address);
    if (balance > previousBalance) return { balance, pending: false };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { balance: previousBalance, pending: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!authToken) return res.status(401).json({ error: 'Missing wallet identity key' });

    const wallet = await resolveWalletByToken(authToken, sbGet);
    if (!wallet) return res.status(401).json({ error: 'Invalid wallet identity key' });
    if (wallet.wallet_type !== 'circle' || !wallet.circle_wallet_id) {
      return res.status(400).json({ error: 'Gateway operations require a Circle wallet identity' });
    }

    if (req.method === 'GET') {
      const gatewayBalance = await loadGatewayBalance(wallet.arc_address);
      return res.status(200).json({
        success: true,
        gateway_balance_usdc: gatewayBalance,
        depositor: wallet.arc_address,
        domain: ARC_DOMAIN,
        gateway_wallet_contract: GATEWAY_WALLET_CONTRACT,
      });
    }

    if (req.method === 'POST') {
      const amount = String(req.body?.amount || '1.0');
      const amountAtomic = parseUnits(amount, 6).toString();
      const previousBalance = await loadGatewayBalance(wallet.arc_address);

      const approveTxId = await createContractExecution({
        walletId: wallet.circle_wallet_id,
        walletAddress: wallet.arc_address,
        contractAddress: USDC_ADDRESS,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [GATEWAY_WALLET_CONTRACT, amountAtomic],
        refId: `arcport-gateway-approve-${wallet.wallet_id}`,
      });
      const approveTx = await waitForDeveloperTransaction(approveTxId);
      if (approveTx.state !== 'COMPLETE') {
        return res.status(500).json({ error: `USDC approve failed: ${approveTx.state}` });
      }

      const depositTxId = await createContractExecution({
        walletId: wallet.circle_wallet_id,
        walletAddress: wallet.arc_address,
        contractAddress: GATEWAY_WALLET_CONTRACT,
        abiFunctionSignature: 'deposit(address,uint256)',
        abiParameters: [USDC_ADDRESS, amountAtomic],
        refId: `arcport-gateway-deposit-${wallet.wallet_id}`,
      });
      const depositTx = await waitForDeveloperTransaction(depositTxId);
      if (depositTx.state !== 'COMPLETE') {
        return res.status(500).json({ error: `Gateway deposit failed: ${depositTx.state}` });
      }

      const balanceState = await waitForGatewayBalance(wallet.arc_address, previousBalance);
      return res.status(200).json({
        success: true,
        amount_usdc: amount,
        gateway_balance_usdc: balanceState.balance,
        pending_indexing: balanceState.pending,
        approve_tx_id: approveTxId,
        approve_hash: approveTx.txHash || null,
        deposit_tx_id: depositTxId,
        deposit_hash: depositTx.txHash || null,
        gateway_wallet_contract: GATEWAY_WALLET_CONTRACT,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
