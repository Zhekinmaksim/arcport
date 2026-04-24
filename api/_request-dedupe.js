function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
  };
}

const STALE_PENDING_MS = 45000;

function sbUrl(table, filter = '') {
  const suffix = filter ? `?${filter}&select=*` : '?select=*';
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${suffix}`;
}

async function sbGet(table, filter) {
  const response = await fetch(sbUrl(table, filter), { headers: sbHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to read ${table}`);
  }
  return response.json();
}

async function sbPost(table, body) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
}

async function sbPatch(table, filter, body) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
}

function schemaMissing(body = '') {
  return /idempotency_requests|schema cache|column|relation/i.test(body);
}

function missingSchemaMessage() {
  return 'Supabase idempotency schema missing. Run the updated supabase-v2-migration.sql before using session mode.';
}

function buildPendingResponse() {
  return {
    status: 202,
    body: {
      error: 'Request is still processing. Retry with the same idempotency key.',
      idempotency_status: 'pending',
    },
  };
}

function buildReplay(row) {
  return {
    kind: 'replay',
    status: Number(row.response_status || (row.status === 'completed' ? 200 : 500)),
    body: row.response_body || {
      error: row.status === 'completed' ? 'Cached request response missing' : 'Cached request error missing',
    },
  };
}

function rowTimestampMs(row = {}) {
  const source = row.updated_at || row.created_at || null;
  const ts = source ? Date.parse(source) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

function isStalePending(row = {}) {
  return row.status === 'pending' && (Date.now() - rowTimestampMs(row)) > STALE_PENDING_MS;
}

async function markPendingRequestFailed(requestKey, payload) {
  await sbPatch('idempotency_requests', `request_key=eq.${encodeURIComponent(requestKey)}`, {
    status: 'failed',
    response_status: payload.responseStatus,
    response_body: payload.responseBody,
    updated_at: new Date().toISOString(),
  });
}

export function getIdempotencyKey(req) {
  const key = (req.headers['x-idempotency-key'] || '').trim();
  if (!key) {
    const error = new Error('X-Idempotency-Key header is required for session mutations');
    error.statusCode = 400;
    throw error;
  }
  return key;
}

export async function acquireIdempotencyRequest({
  requestKey,
  requestScope,
  walletId,
  channelId = null,
  requestBody = {},
}) {
  const insertBody = {
    request_key: requestKey,
    request_scope: requestScope,
    wallet_id: walletId,
    channel_id: channelId,
    status: 'pending',
    request_body: requestBody,
    updated_at: new Date().toISOString(),
  };

  const insertResponse = await sbPost('idempotency_requests', insertBody).catch(() => null);

  if (insertResponse?.ok) {
    const rows = await insertResponse.json().catch(() => []);
    return { kind: 'acquired', row: rows[0] || null };
  }

  const body = insertResponse ? await insertResponse.text().catch(() => '') : '';
  if (schemaMissing(body)) {
    const error = new Error(missingSchemaMessage());
    error.statusCode = 500;
    throw error;
  }

  if (insertResponse?.status === 409) {
    const byKey = await sbGet('idempotency_requests', `request_key=eq.${encodeURIComponent(requestKey)}`);
    if (byKey[0]) {
      if (isStalePending(byKey[0])) {
        await markPendingRequestFailed(requestKey, {
          responseStatus: 504,
          responseBody: { error: 'This request timed out while waiting on an external dependency.' },
        });
        return buildReplay({
          ...byKey[0],
          status: 'failed',
          response_status: 504,
          response_body: { error: 'This request timed out while waiting on an external dependency.' },
        });
      }
      if (byKey[0].status === 'completed' || byKey[0].status === 'failed') {
        return buildReplay(byKey[0]);
      }
      return { kind: 'pending', ...buildPendingResponse() };
    }

    if (requestScope === 'session-call' && channelId) {
      const byChannel = await sbGet(
        'idempotency_requests',
        `request_scope=eq.session-call&channel_id=eq.${encodeURIComponent(channelId)}&status=eq.pending&order=created_at.desc&limit=1`
      );
      if (byChannel[0]) {
        if (isStalePending(byChannel[0])) {
          await markPendingRequestFailed(byChannel[0].request_key, {
            responseStatus: 504,
            responseBody: { error: 'Previous session call timed out and the lock was released. Retry the call.' },
          });
          const retryInsert = await sbPost('idempotency_requests', insertBody).catch(() => null);
          if (retryInsert?.ok) {
            const rows = await retryInsert.json().catch(() => []);
            return { kind: 'acquired', row: rows[0] || null };
          }
        }
        return {
          kind: 'channel-busy',
          status: 409,
          body: {
            error: 'Another session call is already in progress for this session. Retry shortly.',
            idempotency_status: 'channel_busy',
          },
        };
      }
    }
  }

  throw new Error(body || 'Failed to acquire idempotency request');
}

export async function completeIdempotencyRequest(requestKey, {
  responseStatus,
  responseBody,
  channelId = null,
}) {
  const response = await sbPatch('idempotency_requests', `request_key=eq.${encodeURIComponent(requestKey)}`, {
    channel_id: channelId,
    status: 'completed',
    response_status: responseStatus,
    response_body: responseBody,
    updated_at: new Date().toISOString(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (schemaMissing(body)) throw new Error(missingSchemaMessage());
    throw new Error(body || 'Failed to persist idempotency success');
  }
}

export async function failIdempotencyRequest(requestKey, {
  responseStatus,
  responseBody,
  channelId = null,
}) {
  const response = await sbPatch('idempotency_requests', `request_key=eq.${encodeURIComponent(requestKey)}`, {
    channel_id: channelId,
    status: 'failed',
    response_status: responseStatus,
    response_body: responseBody,
    updated_at: new Date().toISOString(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (schemaMissing(body)) throw new Error(missingSchemaMessage());
    throw new Error(body || 'Failed to persist idempotency failure');
  }
}
