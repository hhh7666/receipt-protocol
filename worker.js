// Cross-Venue Receipt Worker v2.8 (Service Worker format)
// Ed25519 signing | Query interface | CORS | Rate limiting | Web UI

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

function html(data, status = 200) {
  return new Response(data, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
  });
}

async function getKeyPair() {
  const stored = await RECEIPTS.get('keys:ed25519', 'json');
  if (stored) return stored;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  );

  const privateKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const keys = { privateKey: privateKeyJWK, publicKey: publicKeyJWK };
  await RECEIPTS.put('keys:ed25519', JSON.stringify(keys));
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
  const count = parseInt((await RECEIPTS.get(windowKey)) || '0');
  if (count >= 30) return false;
  await RECEIPTS.put(windowKey, String(count + 1), { expirationTtl: 120 });
  return true;
}

async function listAllReceipts() {
  let allReceipts = [];
  let cursor;
  do {
    const result = await RECEIPTS.list({ prefix: 'receipt:', cursor, limit: 100 });
    for (const key of result.keys) {
      const val = await RECEIPTS.get(key.name, 'json');
      if (val) allReceipts.push(val);
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  allReceipts.sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1));
  return allReceipts;
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

    await RECEIPTS.put('receipt:' + receipt.id, JSON.stringify(signedReceipt));
    await RECEIPTS.put('agent:' + agent_id, JSON.stringify({
      agent_id, last_action: action, last_platform: platform, last_seen: receipt.issued_at
    }));
    await RECEIPTS.put('agent_receipts:' + agent_id + ':' + receipt.id, JSON.stringify({
      receipt_id: receipt.id, action, platform, issued_at: receipt.issued_at
    }));

    return json(signedReceipt, 201);
  }

  if (path.startsWith('/verify/') && request.method === 'GET') {
    const id = path.split('/verify/')[1];
    const checked_at = new Date().toISOString();
    const query_path = path;

    const stored = await RECEIPTS.get('receipt:' + id);

    if (!stored) {
      const verdictHistory = await RECEIPTS.get('verdict:' + id, 'json');
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
        suggested_next_action: 'Check the receipt ID.'
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

    await RECEIPTS.put('verdict:' + id, JSON.stringify({
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
    const state = await RECEIPTS.get('agent:' + id);
    if (!state) return json({ found: false }, 404);
    return json(JSON.parse(state));
  }

  if (path.startsWith('/receipts/') && request.method === 'GET') {
    const agentId = path.split('/receipts/')[1];
    const prefix = 'agent_receipts:' + agentId + ':';

    let allReceipts = [];
    let cursor;
    do {
      const result = await RECEIPTS.list({ prefix, cursor, limit: 100 });
      for (const key of result.keys) {
        const val = await RECEIPTS.get(key.name, 'json');
        if (val) allReceipts.push(val);
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return json({ agent_id: agentId, count: allReceipts.length, receipts: allReceipts });
  }

  if (path === '/audit' && request.method === 'GET') {
    const allReceipts = await listAllReceipts();
    return json({ total: allReceipts.length, receipts: allReceipts });
  }

  if (path === '/pubkey' && request.method === 'GET') {
    const { publicKey } = await getKeyPair();
    return json({ algorithm: 'Ed25519', publicKey });
  }

  if (path === '/' && request.method === 'GET') {
    // ---- Web UI (server-rendered) ----
    const receipts = await listAllReceipts();
    const { publicKey } = await getKeyPair();

    let rows = '';
    if (receipts.length === 0) {
      rows = '<div class="empty">No receipts yet. Issue the first one.</div>';
    } else {
      for (const r of receipts) {
        const agent = (r.agent_id || 'unknown').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const action = (r.action || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const platform = (r.platform || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const proof = (r.proof || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const sig = (r.signature || '').slice(0, 24) + '…';
        rows += '<div class="card">' +
          '<div class="row"><span class="tag">' + agent + '</span><span class="dot"></span><span class="plat">' + platform + '</span></div>' +
          '<div class="action">' + action + '</div>' +
          '<div class="meta">ID <code>' + r.id + '</code></div>' +
          '<div class="meta">Issued ' + r.issued_at + '</div>' +
          (proof ? '<div class="meta proof">Proof <a href="' + proof + '" target="_blank" rel="noopener">' + proof + '</a></div>' : '') +
          '<div class="meta">Signature <code>' + sig + '</code> <span class="veri">✓ verifiable</span></div>' +
          '<a class="btn small" href="/verify/' + r.id + '" target="_blank">Verify this</a>' +
          '</div>';
      }
    }

    const pubkey = publicKey && publicKey.x ? publicKey.x.slice(0, 24) + '…' : '(auto-generating)';

    const page = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt Protocol — Cross-Venue Behavior Receipts</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; background:#0b1020; color:#e6e9f2; min-height:100vh; }
  .wrap { max-width:760px; margin:0 auto; padding:20px 16px 60px; }
  header { padding:28px 0 20px; border-bottom:1px solid #1d2740; margin-bottom:20px; }
  h1 { font-size:24px; font-weight:700; background:linear-gradient(90deg,#7c9cff,#3ddad7); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .sub { margin-top:6px; color:#8b93ad; font-size:13px; }
  .stats { display:flex; gap:10px; margin:16px 0; }
  .stat { flex:1; background:#141b31; border:1px solid #1f2a45; border-radius:12px; padding:12px; text-align:center; }
  .stat b { display:block; font-size:20px; color:#7c9cff; }
  .stat span { font-size:11px; color:#8b93ad; }
  h2 { font-size:16px; margin:22px 0 12px; color:#aab4d4; }
  .card { background:#141b31; border:1px solid #1f2a45; border-radius:12px; padding:14px; margin-bottom:10px; }
  .row { display:flex; align-items:center; gap:8px; }
  .tag { background:#1e3a5f; color:#9cc5ff; border-radius:6px; padding:2px 8px; font-size:12px; }
  .dot { width:6px; height:6px; border-radius:50%; background:#3ddad7; }
  .plat { color:#8b93ad; font-size:12px; }
  .action { font-size:15px; margin:8px 0; font-weight:600; }
  .meta { font-size:12px; color:#8b93ad; margin-top:4px; word-break:break-all; }
  .meta code { color:#7cc7a8; background:#10202e; padding:1px 4px; border-radius:4px; font-size:11px; }
  .proof a { color:#7c9cff; text-decoration:none; }
  .veri { color:#3ddad7; font-size:11px; }
  .btn { display:inline-block; background:linear-gradient(90deg,#7c9cff,#3ddad7); color:#0b1020; font-weight:700; border:none; border-radius:10px; padding:12px 18px; font-size:14px; cursor:pointer; text-decoration:none; }
  .btn.small { margin-top:10px; padding:6px 12px; font-size:12px; background:#1f2a45; color:#9cc5ff; }
  form { background:#141b31; border:1px solid #1f2a45; border-radius:12px; padding:16px; }
  label { display:block; font-size:12px; color:#8b93ad; margin:10px 0 4px; }
  input,select { width:100%; background:#0d1226; border:1px solid #243152; color:#e6e9f2; border-radius:8px; padding:10px; font-size:14px; }
  input:focus { outline:none; border-color:#7c9cff; }
  .formrow { display:flex; gap:8px; margin-top:14px; }
  .empty { color:#8b93ad; text-align:center; padding:30px 0; }
  .pub { background:#141b31; border:1px solid #1f2a45; border-radius:12px; padding:12px; font-size:11px; color:#7cc7a8; word-break:break-all; margin-top:20px; }
  .msg { margin-top:12px; font-size:13px; border-radius:8px; padding:10px; display:none; }
  .msg.ok { display:block; background:#0e2a22; color:#3ddad7; border:1px solid #1d4a3e; }
  .msg.err { display:block; background:#2a1616; color:#ff8a8a; border:1px solid #4a1f1f; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Receipt Protocol</h1>
    <div class="sub">Ed25519-signed behavior receipts · emit in execution field → consume in supply field</div>
  </header>

  <div class="stats">
    <div class="stat"><b>` + receipts.length + `</b><span>receipts</span></div>
    <div class="stat"><b>` + new Set(receipts.map(r => r.agent_id)).size + `</b><span>agents</span></div>
    <div class="stat"><b>` + new Set(receipts.map(r => r.platform)).size + `</b><span>venues</span></div>
  </div>

  <h2>+ Issue New Receipt</h2>
  <form id="issueForm">
    <label>Agent ID</label>
    <input id="agent_id" placeholder="e.g. nova-faryza" required>
    <label>Action</label>
    <input id="action" placeholder="e.g. posted-on-agora" required>
    <label>Platform</label>
    <input id="platform" placeholder="e.g. AGORA" required>
    <label>Proof URL (optional)</label>
    <input id="proof" placeholder="https://…">
    <div class="formrow"><button class="btn" type="submit">Sign & Issue</button></div>
    <div id="issueMsg" class="msg"></div>
  </form>

  <h2>🔍 Verify Receipt</h2>
  <form id="verifyForm">
    <label>Receipt ID</label>
    <input id="verify_id" placeholder="Paste receipt ID">
    <div class="formrow"><button class="btn" type="submit">Verify</button></div>
    <div id="verifyMsg" class="msg"></div>
  </form>

  <h2>📜 All Receipts (` + receipts.length + `）</h2>
  ` + rows + `

  <div class="pub">Ed25519 PublicKey · <code>` + pubkey + `</code></div>
</div>
<script>
(function(){
  var issueForm = document.getElementById('issueForm');
  var verifyForm = document.getElementById('verifyForm');
  var issueMsg = document.getElementById('issueMsg');
  var verifyMsg = document.getElementById('verifyMsg');

  function show(el, text, ok){
    el.textContent = text;
    el.className = 'msg ' + (ok ? 'ok' : 'err');
  }

  issueForm.addEventListener('submit', function(e){
    e.preventDefault();
    var body = {
      agent_id: document.getElementById('agent_id').value.trim(),
      action: document.getElementById('action').value.trim(),
      platform: document.getElementById('platform').value.trim(),
      proof: document.getElementById('proof').value.trim() || undefined
    };
    fetch('/issue', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if(res.ok){
          show(issueMsg, '✅ Issued. ID: ' + res.d.id, true);
          setTimeout(function(){ location.reload(); }, 1200);
        } else {
          show(issueMsg, '❌ ' + (res.d.error || JSON.stringify(res.d)), false);
        }
      }).catch(function(err){ show(issueMsg, '❌ Request failed: ' + err.message, false); });
  });

  verifyForm.addEventListener('submit', function(e){
    e.preventDefault();
    var id = document.getElementById('verify_id').value.trim();
    if(!id){ show(verifyMsg, 'Enter a receipt ID', false); return; }
    fetch('/verify/' + encodeURIComponent(id))
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if(res.d && res.d.verdict){
          show(verifyMsg, '✅ ' + res.d.verdict + (res.d.axes ? ' · Signature valid: ' + res.d.axes.signature_valid_at_signing : ''), res.ok);
        } else {
          show(verifyMsg, '❌ ' + (res.d.error || JSON.stringify(res.d)), false);
        }
      }).catch(function(err){ show(verifyMsg, '❌ Request failed: ' + err.message, false); });
  });
})();
</script>
</body>
</html>`;

    return html(page);
  }

  return json({ error: 'not found' }, 404);
}
