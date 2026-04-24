import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = process.env.ARCPORT_BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_API_ID = process.env.ARCPORT_PROOF_API_ID || 'weather-1';
const DEFAULT_PARAMS = process.env.ARCPORT_PROOF_PARAMS
  ? JSON.parse(process.env.ARCPORT_PROOF_PARAMS)
  : { city: 'Berlin' };

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    identityKey: process.env.ARCPORT_IDENTITY_KEY || '',
    cycles: 17,
    callsPerCycle: 1,
    depositUsdc: 0.001,
    apiId: DEFAULT_API_ID,
    params: DEFAULT_PARAMS,
    outDir: path.resolve(process.cwd(), 'proof'),
    pauseMs: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--base-url' && next) args.baseUrl = next;
    if (arg === '--identity-key' && next) args.identityKey = next;
    if (arg === '--cycles' && next) args.cycles = Number(next);
    if (arg === '--calls-per-cycle' && next) args.callsPerCycle = Number(next);
    if (arg === '--deposit-usdc' && next) args.depositUsdc = Number(next);
    if (arg === '--api-id' && next) args.apiId = next;
    if (arg === '--params-json' && next) args.params = JSON.parse(next);
    if (arg === '--out-dir' && next) args.outDir = path.resolve(process.cwd(), next);
    if (arg === '--pause-ms' && next) args.pauseMs = Number(next);
  }

  if (!args.identityKey) {
    throw new Error('Missing identity key. Pass --identity-key awi_... or set ARCPORT_IDENTITY_KEY.');
  }
  if (!Number.isInteger(args.cycles) || args.cycles <= 0) {
    throw new Error('--cycles must be a positive integer');
  }
  if (!Number.isInteger(args.callsPerCycle) || args.callsPerCycle <= 0) {
    throw new Error('--calls-per-cycle must be a positive integer');
  }
  if (!Number.isFinite(args.depositUsdc) || args.depositUsdc <= 0) {
    throw new Error('--deposit-usdc must be a positive number');
  }

  return args;
}

async function sleep(ms) {
  if (!ms) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(baseUrl, pathname, { identityKey, method = 'POST', body } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      Authorization: `Bearer ${identityKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${JSON.stringify(json)}`);
  }

  return json;
}

function buildSummary({ startedAt, endedAt, config, cycles }) {
  const txs = [];
  let totalCalls = 0;

  for (const cycle of cycles) {
    totalCalls += cycle.calls.length;

    if (cycle.approve_tx_hash) {
      txs.push({ type: 'approve', hash: cycle.approve_tx_hash, cycle: cycle.index, explorer: cycle.explorer?.approve_tx || null });
    }
    if (cycle.open_tx_hash) {
      txs.push({ type: 'open', hash: cycle.open_tx_hash, cycle: cycle.index, explorer: cycle.explorer?.open_tx || null });
    }
    if (cycle.close_tx_hash) {
      txs.push({ type: 'close', hash: cycle.close_tx_hash, cycle: cycle.index, explorer: cycle.explorer?.close_tx || null });
    }
  }

  return {
    started_at: startedAt,
    ended_at: endedAt,
    base_url: config.baseUrl,
    wallet_identity_key_suffix: config.identityKey.slice(-12),
    api_id: config.apiId,
    api_params: config.params,
    cycles_requested: config.cycles,
    calls_per_cycle: config.callsPerCycle,
    deposit_usdc_per_cycle: config.depositUsdc,
    total_calls: totalCalls,
    total_onchain_transactions: txs.length,
    transaction_breakdown: {
      approve: txs.filter(tx => tx.type === 'approve').length,
      open: txs.filter(tx => tx.type === 'open').length,
      close: txs.filter(tx => tx.type === 'close').length,
    },
    meets_50_onchain_requirement: txs.length >= 50,
    transactions: txs,
    cycles,
  };
}

function renderMarkdown(summary) {
  const lines = [
    '# ArcPort Session Proof',
    '',
    `- Generated: ${summary.ended_at}`,
    `- Base URL: ${summary.base_url}`,
    `- Wallet identity suffix: \`${summary.wallet_identity_key_suffix}\``,
    `- API: \`${summary.api_id}\``,
    `- Params: \`${JSON.stringify(summary.api_params)}\``,
    `- Cycles: ${summary.cycles_requested}`,
    `- Calls per cycle: ${summary.calls_per_cycle}`,
    `- Deposit per cycle: ${summary.deposit_usdc_per_cycle} USDC`,
    `- Total API calls: ${summary.total_calls}`,
    `- Total onchain transactions: ${summary.total_onchain_transactions}`,
    `- Breakdown: approve ${summary.transaction_breakdown.approve}, open ${summary.transaction_breakdown.open}, close ${summary.transaction_breakdown.close}`,
    `- Meets 50+ onchain tx requirement: ${summary.meets_50_onchain_requirement ? 'yes' : 'no'}`,
    '',
    '## Cycles',
    '',
  ];

  for (const cycle of summary.cycles) {
    lines.push(`### Cycle ${cycle.index}`);
    lines.push(`- Channel: \`${cycle.channel_id}\``);
    lines.push(`- Calls made: ${cycle.calls.length}`);
    lines.push(`- Spent: ${cycle.cumulative_spent_usdc} USDC`);
    lines.push(`- Refund: ${cycle.refunded_to_agent_usdc} USDC`);
    lines.push(`- Approve tx: ${cycle.approve_tx_hash ? `[${cycle.approve_tx_hash}](https://testnet.arcscan.app/tx/${cycle.approve_tx_hash})` : '-'}`);
    lines.push(`- Open tx: ${cycle.open_tx_hash ? `[${cycle.open_tx_hash}](https://testnet.arcscan.app/tx/${cycle.open_tx_hash})` : '-'}`);
    lines.push(`- Close tx: ${cycle.close_tx_hash ? `[${cycle.close_tx_hash}](https://testnet.arcscan.app/tx/${cycle.close_tx_hash})` : '-'}`);
    lines.push('');
  }

  lines.push('## Flat Transaction List');
  lines.push('');

  for (const tx of summary.transactions) {
    lines.push(`- Cycle ${tx.cycle} ${tx.type}: ${tx.explorer ? `[${tx.hash}](${tx.explorer})` : `\`${tx.hash}\``}`);
  }

  lines.push('');
  lines.push('This proof file was generated by `scripts/session-proof-runner.mjs` against the local ArcPort app.');

  return `${lines.join('\n')}\n`;
}

async function runCycle(index, config) {
  const open = await requestJson(config.baseUrl, '/api/session-open', {
    identityKey: config.identityKey,
    body: {
      deposit_usdc: config.depositUsdc,
      expected_calls: config.callsPerCycle,
    },
  });

  const cycle = {
    index,
    channel_id: open.channel_id,
    approve_tx_hash: open.approve_tx_hash || null,
    open_tx_hash: open.open_tx_hash || null,
    explorer: {
      approve_tx: open.explorer?.approve_tx || null,
      open_tx: open.explorer?.open_tx || null,
      close_tx: null,
    },
    calls: [],
    close_tx_hash: null,
    cumulative_spent_usdc: 0,
    refunded_to_agent_usdc: 0,
  };

  for (let callIndex = 1; callIndex <= config.callsPerCycle; callIndex += 1) {
    const call = await requestJson(config.baseUrl, '/api/session-call', {
      identityKey: config.identityKey,
      body: {
        channel_id: open.channel_id,
        api_id: config.apiId,
        params: config.params,
      },
    });

    cycle.calls.push({
      index: callIndex,
      cumulative_usdc: call.voucher?.cumulative_usdc ?? null,
      remaining_calls: call.session?.remaining_calls ?? null,
      latency_ms: call.api?.latency_ms ?? null,
    });
    cycle.cumulative_spent_usdc = call.session?.spent_usdc ?? cycle.cumulative_spent_usdc;
  }

  const close = await requestJson(config.baseUrl, '/api/session-close', {
    identityKey: config.identityKey,
    body: {
      channel_id: open.channel_id,
    },
  });

  cycle.close_tx_hash = close.close_tx_hash || null;
  cycle.explorer.close_tx = close.explorer || null;
  cycle.refunded_to_agent_usdc = close.refunded_to_agent_usdc ?? 0;
  cycle.cumulative_spent_usdc = close.cumulative_spent_usdc ?? cycle.cumulative_spent_usdc;

  return cycle;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  await mkdir(config.outDir, { recursive: true });

  const cycles = [];
  for (let index = 1; index <= config.cycles; index += 1) {
    console.log(`Running cycle ${index}/${config.cycles}...`);
    const cycle = await runCycle(index, config);
    cycles.push(cycle);
    await sleep(config.pauseMs);
  }

  const endedAt = new Date().toISOString();
  const summary = buildSummary({ startedAt, endedAt, config, cycles });

  const stamp = endedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(config.outDir, `session-proof-${stamp}.json`);
  const mdPath = path.join(config.outDir, `session-proof-${stamp}.md`);
  const latestJsonPath = path.join(config.outDir, 'session-proof-latest.json');
  const latestMdPath = path.join(config.outDir, 'session-proof-latest.md');

  await writeFile(jsonPath, JSON.stringify(summary, null, 2));
  await writeFile(mdPath, renderMarkdown(summary));
  await writeFile(latestJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(latestMdPath, renderMarkdown(summary));

  console.log(`Saved proof JSON: ${jsonPath}`);
  console.log(`Saved proof Markdown: ${mdPath}`);
  console.log(`Total onchain transactions: ${summary.total_onchain_transactions}`);
  console.log(`Meets 50+ requirement: ${summary.meets_50_onchain_requirement ? 'yes' : 'no'}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
