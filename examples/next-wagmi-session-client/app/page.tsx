'use client';

import { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { useAccount, useConnect, useDisconnect, useSignTypedData } from 'wagmi';
import {
  ARCPORT_URL,
  callSession,
  closeSession,
  fetchX402Requirements,
  openSession,
  type X402Requirements,
} from '../lib/arcport';
import { arcscanAddress, arcscanTx } from '../lib/chains';
import { ARCPORT_SESSION_CONTRACT } from '../lib/contracts';
import { budgetAtomic, buildSessionKeyTypedData, defaultPolicy } from '../lib/session-policy';

type LogLine = {
  level: 'info' | 'ok' | 'warn';
  message: string;
};

function short(value?: string) {
  if (!value) return '-';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export default function Page() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const [identityKey, setIdentityKey] = useState('');
  const [requirements, setRequirements] = useState<X402Requirements | null>(null);
  const [channelId, setChannelId] = useState('');
  const [logs, setLogs] = useState<LogLine[]>([
    { level: 'info', message: 'Reference client loaded. Connect a wallet or paste an ArcPort identity key.' },
  ]);

  const policy = defaultPolicy;
  const connector = connectors[0];
  const accepted = requirements?.accepts?.[0];

  const policyTypedData = useMemo(() => {
    if (!address) return null;
    return buildSessionKeyTypedData({
      agent: address,
      policy,
      verifyingContract: ARCPORT_SESSION_CONTRACT,
    });
  }, [address, policy]);

  function addLog(level: LogLine['level'], message: string) {
    setLogs((current) => [{ level, message }, ...current].slice(0, 14));
  }

  async function loadRequirements() {
    addLog('info', 'Requesting x402 requirements from ArcPort...');
    const next = await fetchX402Requirements('social-signal');
    setRequirements(next);
    addLog('ok', `x402 requirement loaded: ${formatUnits(BigInt(next.accepts[0].amount), 6)} USDC`);
  }

  async function signPolicy() {
    if (!policyTypedData) throw new Error('Connect wallet first');
    addLog('info', 'Signing bounded session policy with wagmi...');
    await signTypedDataAsync(policyTypedData);
    addLog('ok', 'Session policy signed. The agent has bounded spend intent.');
  }

  async function openArcPortSession() {
    if (!identityKey) throw new Error('Paste an ArcPort identity key for the live backend path');
    addLog('info', 'Opening ArcPort session through the production runtime...');
    const opened = await openSession(identityKey, {
      agent_runtime: 'next-wagmi-reference-client',
      task: 'frontend reference session key demo',
      allowed_api_ids: policy.allowedApiIds,
      max_calls: policy.maxCalls,
    });
    setChannelId(opened.channel_id);
    addLog('ok', `Session opened: ${short(opened.channel_id)} (${short(opened.open_tx_hash)})`);
  }

  async function makePaidCalls() {
    if (!identityKey || !channelId) throw new Error('Open a session first');
    addLog('info', 'Calling social-signal through the bounded session...');
    await callSession(identityKey, channelId, 'social-signal');
    addLog('ok', 'Paid social-signal call completed.');
    addLog('info', 'Calling Gemini through the same session...');
    await callSession(identityKey, channelId, 'gemini');
    addLog('ok', 'Paid Gemini call completed.');
  }

  async function closeArcPortSession() {
    if (!identityKey || !channelId) throw new Error('Open a session first');
    addLog('info', 'Closing session and settling cumulative spend...');
    const closed = await closeSession(identityKey, channelId);
    addLog('ok', `Session closed: ${short(closed.close_tx_hash)} refund ${closed.refund_usdc || '0'} USDC`);
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      addLog('warn', error instanceof Error ? error.message : 'Unexpected error');
    }
  }

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <div className="mark">
            <svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M10 35V20c0-8 6-14 14-14s14 6 14 14v15" fill="none" stroke="#6ba3ff" strokeWidth="4.4" strokeLinecap="round" />
              <path d="M24 37V14" fill="none" stroke="#6ba3ff" strokeWidth="4.4" strokeLinecap="round" />
              <path d="M16.5 21.5 24 14l7.5 7.5" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-title">Arc<span>Port</span></div>
            <div className="brand-tag">WAGMI CLIENT</div>
          </div>
        </div>
        <div className="chips">
          <div className="chip"><i className="dot" />React / Next</div>
          <div className="chip"><i className="dot" />wagmi + viem</div>
          <div className="chip green"><i className="dot" />x402 + session policy</div>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">Reference frontend</div>
        <h1>Wallet-native session payments for <span>agents</span>.</h1>
        <p className="hero-copy">
          A small Next.js client that shows how ArcPort can expose x402 payment requirements,
          bounded session policy intent, and open-call-close proof through a wagmi/viem frontend.
        </p>
      </section>

      <section className="grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Wallet + x402</div>
            {isConnected ? <div className="chip green"><i className="dot" />{short(address)}</div> : <div className="chip">not connected</div>}
          </div>
          <div className="card-body">
            <div className="row">
              <div className="label">ArcPort URL</div>
              <div className="value">{ARCPORT_URL}</div>
            </div>
            <div className="row">
              <div className="label">Session contract</div>
              <div className="value">
                <a href={arcscanAddress(ARCPORT_SESSION_CONTRACT)} target="_blank" rel="noreferrer">{short(ARCPORT_SESSION_CONTRACT)}</a>
              </div>
            </div>
            <div className="row">
              <div className="label">x402 amount</div>
              <div className="value green">{accepted ? `${formatUnits(BigInt(accepted.amount), 6)} USDC` : 'load requirements'}</div>
            </div>
            <div className="row">
              <div className="label">x402 network</div>
              <div className="value">{accepted?.network || 'eip155:5042002'}</div>
            </div>

            <input
              className="input"
              value={identityKey}
              onChange={(event) => setIdentityKey(event.target.value)}
              placeholder="Optional live backend key: awi_..."
            />

            <div className="actions">
              {isConnected ? (
                <button className="button secondary" onClick={() => disconnect()}>Disconnect</button>
              ) : (
                <button className="button" disabled={!connector || isPending} onClick={() => connector && connect({ connector })}>
                  Connect wallet
                </button>
              )}
              <button className="button secondary" onClick={() => run(loadRequirements)}>Load x402</button>
              <button className="button secondary" disabled={!isConnected} onClick={() => run(signPolicy)}>Sign policy</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Session key policy</div>
            <div className="chip green"><i className="dot" />bounded</div>
          </div>
          <div className="card-body">
            <div className="row">
              <div className="label">Budget</div>
              <div className="value green">{policy.budgetUsdc} USDC ({budgetAtomic(policy).toString()} atomic)</div>
            </div>
            <div className="row">
              <div className="label">Max calls</div>
              <div className="value">{policy.maxCalls}</div>
            </div>
            <div className="row">
              <div className="label">Allowed APIs</div>
              <div className="value">{policy.allowedApiIds.join(', ')}</div>
            </div>
            <div className="row">
              <div className="label">Expiry</div>
              <div className="value">{policy.expiryMinutes} minutes</div>
            </div>
            <p className="footer-note">
              This reference client models session keys as policy intent. Production ArcPort still settles through the deployed
              session contract and machine-facing session API.
            </p>
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 22 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Lifecycle</div>
            {channelId ? <div className="chip green"><i className="dot" />{short(channelId)}</div> : <div className="chip">no channel</div>}
          </div>
          <div className="card-body">
            <div className="steps">
              <div className="step">
                <div className="num">1</div>
                <div>
                  <h3>Open bounded session</h3>
                  <p>One onchain open locks a USDC budget for the agent run.</p>
                </div>
              </div>
              <div className="step">
                <div className="num">2</div>
                <div>
                  <h3>Call paid APIs</h3>
                  <p>Social signal and Gemini calls spend against the same session policy.</p>
                </div>
              </div>
              <div className="step">
                <div className="num">3</div>
                <div>
                  <h3>Close and refund</h3>
                  <p>Final cumulative spend settles on Arc. Unused budget returns to the agent wallet.</p>
                </div>
              </div>
            </div>

            <div className="actions">
              <button className="button" onClick={() => run(openArcPortSession)}>Open session</button>
              <button className="button secondary" disabled={!channelId} onClick={() => run(makePaidCalls)}>Make calls</button>
              <button className="button secondary" disabled={!channelId} onClick={() => run(closeArcPortSession)}>Close session</button>
              {channelId ? (
                <a className="button secondary" href={`${ARCPORT_URL}/?proof=${channelId}`} target="_blank" rel="noreferrer">Open Proof Mode</a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Runtime log</div>
            <div className="chip">reference</div>
          </div>
          <div className="card-body">
            <div className="log">
              {logs.map((line, index) => (
                <div key={`${line.message}-${index}`}>
                  [{line.level.toUpperCase()}] {line.message}
                </div>
              ))}
            </div>
            <p className="footer-note">
              If a close hash appears in the ArcPort API response, inspect it on Arcscan:
              {' '}<a href={arcscanTx('0x0000000000000000000000000000000000000000000000000000000000000000')} target="_blank" rel="noreferrer">tx link shape</a>.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

