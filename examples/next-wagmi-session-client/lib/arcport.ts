export const ARCPORT_URL = process.env.NEXT_PUBLIC_ARCPORT_URL || 'https://arcport.xyz';

export type X402Requirements = {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    amount: string;
    payTo: string;
    asset: string;
    extra?: Record<string, unknown>;
  }>;
  resource?: {
    url: string;
    description: string;
    mimeType: string;
  };
};

export async function fetchX402Requirements(apiId = 'social-signal'): Promise<X402Requirements> {
  const response = await fetch(`${ARCPORT_URL}/api/pay-and-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_id: apiId, params: { dry_run: true } }),
  });

  const body = await response.json();
  if (response.status !== 402 && !body?.accepts) {
    throw new Error(body?.error || 'ArcPort did not return x402 requirements');
  }
  return body;
}

export async function openSession(identityKey: string, metadata: Record<string, unknown>) {
  const response = await fetch(`${ARCPORT_URL}/api/session-open`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identityKey}`,
    },
    body: JSON.stringify({
      deposit_usdc: '0.01',
      metadata,
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'Failed to open ArcPort session');
  return body;
}

export async function callSession(identityKey: string, channelId: string, apiId: string) {
  const response = await fetch(`${ARCPORT_URL}/api/session-call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identityKey}`,
    },
    body: JSON.stringify({
      channel_id: channelId,
      api_id: apiId,
      params: apiId === 'gemini'
        ? { prompt: 'Write one concise decision memo for a bounded paid agent run.' }
        : { symbol: 'ETH', side: 'short', score: 0.318, drawdown: '14%' },
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'Failed to call ArcPort session API');
  return body;
}

export async function closeSession(identityKey: string, channelId: string) {
  const response = await fetch(`${ARCPORT_URL}/api/session-close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identityKey}`,
    },
    body: JSON.stringify({ channel_id: channelId }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'Failed to close ArcPort session');
  return body;
}

