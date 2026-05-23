const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});

const sbGet = (table, query = '') => {
  const suffix = query ? `?select=*&${query}` : '?select=*';
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}${suffix}`, { headers: sbH() }).then(r => r.json());
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataOf(row) {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}

function atomicUsdc(value) {
  try {
    return Number(BigInt(value || 0)) / 1e6;
  } catch (_) {
    return 0;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [sessionRows, transactionRows] = await Promise.all([
      sbGet('session_channels', 'order=created_at.desc&limit=1000'),
      sbGet('transactions', 'order=created_at.desc&limit=1000'),
    ]);

    const sessions = Array.isArray(sessionRows) ? sessionRows : [];
    const transactions = Array.isArray(transactionRows) ? transactionRows : [];
    const closedSessions = sessions.filter(row => row.status === 'closed');
    const externalAgentSessions = sessions.filter(row => {
      const runtime = String(metadataOf(row).agent_runtime || '').trim().toLowerCase();
      return runtime && runtime !== 'browser control plane';
    });

    const sessionCalls = sessions.reduce((sum, row) => sum + number(row.calls_total), 0);
    const sessionSpentUsdc = sessions.reduce((sum, row) => sum + number(row.cumulative_spent), 0);
    const refundUsdc = closedSessions.reduce((sum, row) => {
      const metadata = metadataOf(row);
      return sum + atomicUsdc(metadata.refunded_to_agent_atomic);
    }, 0);
    const chargeVolumeUsdc = transactions.reduce((sum, row) => sum + number(row.amount), 0);

    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      positioning: 'ArcPort V3 is a session-based payment runtime for RFB 06 social trading agents that need repeated paid signal intelligence on Arc.',
      metrics: {
        session_count: sessions.length,
        closed_session_count: closedSessions.length,
        external_agent_session_count: externalAgentSessions.length,
        charge_call_count: transactions.length,
        session_call_count: sessionCalls,
        total_paid_call_count: transactions.length + sessionCalls,
        session_spent_usdc: Number(sessionSpentUsdc.toFixed(6)),
        charge_volume_usdc: Number(chargeVolumeUsdc.toFixed(6)),
        total_volume_usdc: Number((sessionSpentUsdc + chargeVolumeUsdc).toFixed(6)),
        refunded_usdc: Number(refundUsdc.toFixed(6)),
      },
      proof_fields: [
        'open_tx_hash',
        'close_tx_hash',
        'calls_total',
        'cumulative_spent',
        'refund',
        'agent_runtime',
        'allowed_api_ids',
        'max_calls',
      ],
      agora_fit: {
        agentic_sophistication: 'External social trading agents can open bounded sessions, evaluate repeated trader signals, and close with refund proof.',
        traction: 'The endpoint exposes live sessions, paid calls, USDC volume, and refunds for submission updates.',
        circle_usage: 'USDC, Circle Wallets, Gateway/Nanopayments, Arc settlement, and Arcscan proof.',
        innovation: 'Session mode makes repeated agent usage practical by separating onchain settlement from offchain signed calls.',
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
