// api/webhook-worker.js
// Runs every minute via Vercel Cron
// Polls ARC Testnet for USDC Transfer events, fires webhooks

import { ethers } from 'ethers';
import { createHmac } from 'crypto';

const ARC_RPC      = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];

const sbH = () => ({ 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` });
const sbGet   = (t, f) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPatch = (t, f, b) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}`, { method: 'PATCH', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(b) });
const sbPost  = (t, b) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(b) });

function sign(secret, body) {
  return 'sha256=' + createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

async function deliver(sub, payload) {
  try {
    const r = await fetch(sub.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AgentPay-Signature': sign(sub.secret, payload), 'X-AgentPay-Event': payload.event, 'User-Agent': 'AgentPay-Webhooks/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return { success: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default async function handler(req, res) {
  // Security check
  if (req.headers['x-vercel-cron'] !== '1' && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const t0 = Date.now();
  const stats = { subscriptions: 0, events_found: 0, webhooks_fired: 0, failed: 0 };

  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC, { chainId: ARC_CHAIN_ID, name: 'arc-testnet' });
    const currentBlock = await provider.getBlockNumber();
    const usdc = new ethers.Contract(USDC_ADDRESS, TRANSFER_ABI, provider);

    const subs = await sbGet('webhook_subscriptions', 'active=eq.true');
    stats.subscriptions = subs.length;
    if (!subs.length) return res.status(200).json({ message: 'No active subscriptions', ...stats });

    // Group by address to minimize RPC calls
    const byAddress = new Map();
    subs.forEach(s => {
      const addr = s.arc_address.toLowerCase();
      if (!byAddress.has(addr)) byAddress.set(addr, []);
      byAddress.get(addr).push(s);
    });

    for (const [addr, addrSubs] of byAddress) {
      const minBlock = addrSubs.reduce((min, s) => Math.min(min, s.last_block_checked ? Number(s.last_block_checked) : currentBlock - 50), currentBlock - 50);
      const fromBlock = Math.max(minBlock + 1, currentBlock - 500);
      if (fromBlock > currentBlock) { continue; }

      try {
        const [logsIn, logsOut] = await Promise.all([
          usdc.queryFilter(usdc.filters.Transfer(null, addr), fromBlock, currentBlock),
          usdc.queryFilter(usdc.filters.Transfer(addr, null), fromBlock, currentBlock),
        ]);

        const allEvents = [
          ...logsIn.map(l => ({ ...l, dir: 'in' })),
          ...logsOut.map(l => ({ ...l, dir: 'out' })),
        ].sort((a, b) => a.blockNumber - b.blockNumber);

        stats.events_found += allEvents.length;

        for (const log of allEvents) {
          const event = `transfer.${log.dir}`;
          const payload = {
            event,
            network: 'ARC Testnet',
            chain_id: ARC_CHAIN_ID,
            arc_address: addr,
            tx_hash: log.transactionHash,
            block_number: log.blockNumber,
            from: log.args.from.toLowerCase(),
            to: log.args.to.toLowerCase(),
            amount_usdc: ethers.formatUnits(log.args.value, 18),
            token: 'USDC',
            explorer: `https://testnet.arcscan.app/tx/${log.transactionHash}`,
            timestamp: new Date().toISOString(),
          };

          for (const sub of addrSubs) {
            if (!sub.events.includes(event) && !sub.events.includes('transfer.any')) continue;
            const result = await deliver(sub, payload);
            stats.webhooks_fired++;
            if (!result.success) stats.failed++;

            await sbPost('webhook_deliveries', { subscription_id: sub.id, tx_hash: log.transactionHash, event, payload, status: result.success ? 'delivered' : 'failed', http_status: result.status || null, error: result.error || null });
            await sbPatch('webhook_subscriptions', `id=eq.${sub.id}`, { last_triggered: new Date().toISOString(), deliveries_total: (sub.deliveries_total || 0) + 1, deliveries_failed: (sub.deliveries_failed || 0) + (result.success ? 0 : 1) });
          }
        }

        for (const sub of addrSubs) {
          await sbPatch('webhook_subscriptions', `id=eq.${sub.id}`, { last_block_checked: currentBlock });
        }
      } catch (e) {
        console.error(`Error processing ${addr}:`, e.message);
      }
    }

  } catch (e) {
    return res.status(500).json({ error: e.message, ...stats });
  }

  return res.status(200).json({ success: true, elapsed_ms: Date.now() - t0, current_block: 'checked', ...stats });
}
