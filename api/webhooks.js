// api/webhooks.js
// ARC Webhook API — subscribe to USDC transactions on any ARC address

const sbH = () => ({ 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` });
const sbGet = async (table, filter) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPost = async (table, body) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: { ...sbH(), 'Prefer': 'return=representation' }, body: JSON.stringify(body) }).then(r => r.json());
const sbDel = async (table, filter) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: sbH() });

const genSecret = () => 'whsec_' + Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.random() * 36 | 0]).join('');
const validEvents = ['transfer.in', 'transfer.out', 'transfer.any'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const agentKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!agentKey || !agentKey.startsWith('apk_')) return res.status(401).json({ error: 'Missing agent key' });

  const wallets = await sbGet('agent_wallets', `agent_key=eq.${encodeURIComponent(agentKey)}`);
  if (!wallets[0]) return res.status(401).json({ error: 'Invalid agent key' });

  if (req.method === 'GET') {
    const subs = await sbGet('webhook_subscriptions', `agent_key=eq.${encodeURIComponent(agentKey)}&order=created_at.desc`);
    return res.status(200).json({ subscriptions: subs });
  }

  if (req.method === 'POST') {
    const { arc_address, url, events = ['transfer.in', 'transfer.out'] } = req.body || {};
    if (!arc_address) return res.status(400).json({ error: 'arc_address is required' });
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!arc_address.startsWith('0x') || arc_address.length !== 42) return res.status(400).json({ error: 'Invalid ARC address (must be 0x + 40 hex chars)' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    const bad = events.filter(e => !validEvents.includes(e));
    if (bad.length) return res.status(400).json({ error: `Invalid events: ${bad.join(', ')}. Valid: ${validEvents.join(', ')}` });

    const existing = await sbGet('webhook_subscriptions', `agent_key=eq.${encodeURIComponent(agentKey)}&active=eq.true`);
    if (existing.length >= 10) return res.status(429).json({ error: 'Max 10 active subscriptions per agent key' });

    const rows = await sbPost('webhook_subscriptions', { agent_key: agentKey, arc_address: arc_address.toLowerCase(), url, events, secret: genSecret(), active: true, deliveries_total: 0, deliveries_failed: 0 });
    return res.status(201).json({ success: true, subscription: rows[0] });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const subs = await sbGet('webhook_subscriptions', `id=eq.${id}&agent_key=eq.${encodeURIComponent(agentKey)}`);
    if (!subs[0]) return res.status(404).json({ error: 'Subscription not found' });
    await sbDel('webhook_subscriptions', `id=eq.${id}`);
    return res.status(200).json({ success: true, deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
