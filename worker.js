// Cross-Venue Receipt Worker v2 (Service Worker format)
// Ed25519 signing | Query interface | CORS | Rate limiting

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function getKeyPair() {
  const stored = await env.RECEIPTS.get('keys:ed25519', 'json');
  if (stored) return stored;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  );

  const privateKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const keys = { privateKey: privateKeyJWK, publicKey: publicKeyJWK };
  await env.RECEIPTS.put('keys:ed25519', JSON.stringify(keys));
  return keys;
}

async function signData(data) {
  const { privateKey } = await getKeyPair();
  const key = await crypto.subtle.importKey('jwk', privateKey, { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key,
    new TextEncoder().encode(JSON.stringify(data)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifySignature(data, signatureB64) {
  try {
    const { publicKey } = await getKeyPair();
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes,
      new TextEncoder().encode(JSON.stringify(data)));
  } catch { return false; }
}

async function checkRateLimit(ip) {
  const windowKey = 'ratelimit:' + ip + ':' + Math.floor(Date.now() / 60000);
  const count = parseInt((await env.RECEIPTS.get(windowKey)) || '0');
  if (count >= 30) return false;
  await env.RECEIPTS.put(windowKey, String(count + 1), { expirationTtl: 120 });
  return true;
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(ip))) {
    return json({ error: 'rate limit exceeded', limit: '30/min' }, 429);
  }

  if (path === '/issue' && request.method === 'POST') {
    const body = await request.json();
    const { agent_id, action, platform, proof } = body;

    if (!agent_id || !action || !platform) {
      return json({ error: 'agent_id, action, platform required' }, 400);
    }

    const receipt = {
      id: crypto.randomUUID(),
      agent_id,
      action,
      platform,
      proof: proof || null,
      issued_at: new Date().toISOString(),
      verifiable: true
    };

    const signature = await signData(receipt);
    const signedReceipt = { ...receipt, signature };

    await env.RECEIPTS.put('receipt:' + receipt.id, JSON.stringify(signedReceipt));
    await env.RECEIPTS.put('agent:' + agent_id, JSON.stringify({
      agent_id, last_action: action, last_platform: platform, last_seen: receipt.issued_at
    }));
    await env.RECEIPTS.put('agent_receipts:' + agent_id + ':' + receipt.id, JSON.stringify({
      receipt_id: receipt.id, action, platform, issued_at: receipt.issued_at
    }));

    return json(signedReceipt, 201);
  }

  if (path.startsWith('/verify/') && request.method === 'GET') {
    const id = path.split('/verify/')[1];
    const checked_at = new Date().toISOString();
    const query_path = path;

    const stored = await env.RECEIPTS.get('receipt:' + id);

    if (!stored) {
      // Check verdict history to distinguish "never existed" from "existed then deleted"
      const verdictHistory = await env.RECEIPTS.get('verdict:' + id, 'json');
      if (verdictHistory && verdictHistory.signature_valid_at_signing) {
        return json({
          verdict: 'WAS_VERIFIED_NOW_ABSENT',
          receipt_id: id,
          axes: {
            signature_valid_at_signing: true,
            bytes_present_now: false,
            key_current_standing: 'unknown',
            verifier_observation: 'bytes absent, but signature was valid at signing time'
          },
          checked_at,
          query_path,
          cache_policy: 'fresh',
          suggested_next_action: 'Do not retry issuance. The receipt existed and was later removed.'
        });
      }
      return json({
        verdict: 'NOT_FOUND',
        receipt_id: id,
        axes: {
          signature_valid_at_signing: 'unknown',
          bytes_present_now: false,
          key_current_standing: 'unknown',
          verifier_observation: 'no receipt found on this route'
        },
        checked_at,
        query_path,
        cache_policy: 'fresh',
        suggested_next_action: 'Check the receipt ID. If issuance returned an id but you get this, it may be an ABSENT_AFTER_ACCEPT phantom write.'
      }, 404);
    }

    const signedReceipt = JSON.parse(stored);
    const { signature, ...receiptData } = signedReceipt;

    if (!signature) {
      return json({
        verdict: 'NO_SIGNATURE',
        receipt_id: id,
        axes: {
          signature_valid_at_signing: false,
          bytes_present_now: true,
          key_current_standing: 'unknown',
          verifier_observation: 'receipt has no signature'
        },
        checked_at,
        query_path
      }, 400);
    }

    const sigValid = await verifySignature(receiptData, signature);

    // Record verdict history (append-only)
    await env.RECEIPTS.put('verdict:' + id, JSON.stringify({
      receipt_id: id,
      signature_valid_at_signing: sigValid,
      last_checked_at: checked_at,
      query_path
    }));

    return json({
      verdict: sigValid ? 'VERIFIED' : 'TAMPERED',
      receipt: signedReceipt,
      axes: {
        signature_valid_at_signing: sigValid,
        bytes_present_now: true,
        key_current_standing: 'unknown',
        verifier_observation: sigValid ? 'signature valid, bytes present on this route' : 'signature mismatch'
      },
      checked_at,
      query_path,
      cache_policy: 'fresh',
      note: 'Proves: issuer signed this, bytes present on this route. Does NOT prove: the underlying action happened, or the key still belongs to the same entity.'
    });
  }

  if (path.startsWith('/agent/') && request.method === 'GET') {
    const id = path.split('/agent/')[1];
    const state = await env.RECEIPTS.get('agent:' + id);
    if (!state) return json({ found: false }, 404);
    return json(JSON.parse(state));
  }

  if (path.startsWith('/receipts/') && request.method === 'GET') {
    const agentId = path.split('/receipts/')[1];
    const prefix = 'agent_receipts:' + agentId + ':';

    let allReceipts = [];
    let cursor;
    do {
      const result = await env.RECEIPTS.list({ prefix, cursor, limit: 100 });
      for (const key of result.keys) {
        const val = await env.RECEIPTS.get(key.name, 'json');
        if (val) allReceipts.push(val);
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return json({ agent_id: agentId, count: allReceipts.length, receipts: allReceipts });
  }

  if (path === '/audit' && request.method === 'GET') {
    // Global audit: list ALL receipts across agents (consumption endpoint)
    let allReceipts = [];
    let cursor;
    do {
      const result = await env.RECEIPTS.list({ prefix: 'receipt:', cursor, limit: 100 });
      for (const key of result.keys) {
        const val = await env.RECEIPTS.get(key.name, 'json');
        if (val) allReceipts.push(val);
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return json({ total: allReceipts.length, receipts: allReceipts });
  }

  if (path === '/pubkey' && request.method === 'GET') {
    const { publicKey } = await getKeyPair();
    return json({ algorithm: 'Ed25519', publicKey });
  }

  if (path === '/' && request.method === 'GET') {
    return json({
      service: 'cross-venue-receipt-v2',
      features: ['ed25519-signing', 'query', 'cors', 'rate-limiting'],
      endpoints: {
        'POST /issue': 'Issue a signed receipt (body: agent_id, action, platform, proof?)',
        'GET /verify/:id': 'Verify a receipt by ID (checks Ed25519 signature)',
        'GET /agent/:id': 'Get agent latest state',
        'GET /receipts/:agent_id': 'List all receipts for an agent',
        'GET /audit': 'List ALL receipts across all agents (global audit)',
        'GET /pubkey': 'Get Ed25519 public key (JWK) for external verification'
      },
      rate_limit: '30 requests/min per IP'
    });
  }

  return json({ error: 'not found' }, 404);
}
