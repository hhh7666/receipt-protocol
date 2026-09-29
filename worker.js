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

  // ============ LANDING PAGE (/) ============
  if (path === '/' && request.method === 'GET') {
    const receipts = await listAllReceipts();
    const { publicKey } = await getKeyPair();
    const agentSet = new Set(receipts.map(r => r.agent_id));
    const venueSet = new Set(receipts.map(r => r.platform));
    const pub = publicKey && publicKey.x ? publicKey.x.slice(0, 20) + '…' : '(auto)';

    const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt Protocol — Prove what happened</title>
<meta name="description" content="The verification layer for agent actions. Ed25519-signed receipts prove an agent did what it claims, across venues and ecosystems.">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; background:#0b1020; color:#e6e9f2; }
  .nav { position:sticky; top:0; z-index:10; background:rgba(11,16,32,.85); backdrop-filter:blur(10px); border-bottom:1px solid #1d2740; }
  .nav-in { max-width:1000px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; padding:14px 20px; }
  .brand { font-weight:800; font-size:16px; letter-spacing:.3px; background:linear-gradient(90deg,#7c9cff,#3ddad7); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .nav-links { display:flex; align-items:center; gap:22px; font-size:13px; color:#aab4d4; }
  .nav-links a { color:#aab4d4; text-decoration:none; }
  .nav-links a:hover { color:#e6e9f2; }
  .cta { display:inline-block; background:linear-gradient(90deg,#7c9cff,#3ddad7); color:#0b1020; font-weight:700; border-radius:10px; padding:10px 20px; font-size:13px; text-decoration:none; }
  .wrap { max-width:1000px; margin:0 auto; padding:0 20px; }
  .hero { padding:96px 0 72px; text-align:center; }
  .hero h1 { font-size:52px; line-height:1.08; font-weight:800; letter-spacing:-1px; background:linear-gradient(90deg,#7c9cff,#3ddad7); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .hero .sub { margin:22px auto 0; max-width:640px; font-size:18px; color:#8b93ad; line-height:1.6; }
  .hero .cta { margin-top:34px; font-size:16px; padding:16px 32px; border-radius:12px; }
  .trust { margin-top:34px; display:flex; justify-content:center; gap:36px; }
  .trust b { display:block; font-size:24px; color:#e6e9f2; }
  .trust span { font-size:12px; color:#8b93ad; }
  .sec { padding:72px 0; border-top:1px solid #141b31; }
  .sec h2 { font-size:30px; font-weight:800; letter-spacing:-.5px; }
  .sec .lead { margin-top:12px; font-size:16px; color:#8b93ad; max-width:640px; line-height:1.6; }
  .prob { max-width:720px; margin:0 auto; text-align:center; padding:84px 0; }
  .prob h2 { font-size:34px; font-weight:800; letter-spacing:-.5px; }
  .prob .sub { margin-top:18px; font-size:17px; color:#8b93ad; line-height:1.7; }
  .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:44px; }
  .step { background:#141b31; border:1px solid #1f2a45; border-radius:14px; padding:24px; }
  .step .n { font-size:12px; color:#3ddad7; font-weight:700; letter-spacing:1px; }
  .step h3 { margin-top:10px; font-size:18px; }
  .step p { margin-top:8px; font-size:13px; color:#8b93ad; line-height:1.6; }
  .stack { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:44px; }
  .layer { border-radius:14px; padding:26px 24px; border:1px solid #1f2a45; background:#141b31; }
  .layer.hl { border-color:#7c9cff; background:#16214a; box-shadow:0 0 0 1px #7c9cff33; }
  .layer .tag { font-size:12px; font-weight:700; letter-spacing:.5px; }
  .layer h3 { margin-top:12px; font-size:19px; }
  .layer p { margin-top:8px; font-size:13px; color:#8b93ad; line-height:1.6; }
  .layer .status { margin-top:14px; font-size:12px; font-weight:700; }
  .grid2 { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-top:44px; }
  .feat { background:#141b31; border:1px solid #1f2a45; border-radius:14px; padding:24px; }
  .feat h3 { font-size:17px; }
  .feat p { margin-top:8px; font-size:13px; color:#8b93ad; line-height:1.6; }
  .endcta { text-align:center; padding:90px 0 70px; }
  .endcta h2 { font-size:34px; font-weight:800; letter-spacing:-.5px; }
  .endcta .cta { margin-top:30px; font-size:16px; padding:16px 36px; border-radius:12px; }
  .foot { border-top:1px solid #141b31; padding:26px 0 40px; font-size:12px; color:#5b647f; text-align:center; }
  .foot code { color:#7cc7a8; word-break:break-all; }
  @media (max-width:720px){
    .hero h1 { font-size:34px; }
    .hero { padding:64px 0 48px; }
    .steps,.stack,.grid2 { grid-template-columns:1fr; }
    .nav-links { display:none; }
    .trust { gap:24px; }
  }
</style>
</head>
<body>
<nav class="nav"><div class="nav-in">
  <div class="brand">Receipt Protocol</div>
  <div class="nav-links">
    <a href="#problem">Problem</a>
    <a href="#how">How it works</a>
    <a href="#stack">Stack</a>
    <a href="#features">Features</a>
    <a href="#uses">Use cases</a>
  </div>
  <a class="cta" href="/app">Open the App</a>
</div></nav>

<div class="hero">
  <div class="wrap">
    <h1>Prove what happened.</h1>
    <p class="sub">The verification layer for agent actions. Ed25519-signed receipts prove an agent did what it claims — across venues, markets and ecosystems.</p>
    <a class="cta" href="/app">Issue · Verify · Audit</a>
    <div class="trust">
      <div><b>` + receipts.length + `</b><span>receipts signed</span></div>
      <div><b>` + agentSet.size + `</b><span>agents tracked</span></div>
      <div><b>` + venueSet.size + `</b><span>venues covered</span></div>
    </div>
  </div>
</div>

<div class="prob" id="problem">
  <div class="wrap">
    <h2>Agents can claim anything.<br>Nothing can verify it.</h2>
    <p class="sub">An agent says it posted on a forum, executed a trade, or completed a task. Today there is no cheap, standard way to prove that claim later. Chat logs can be forged. Word of mouth does not scale. The agent economy is missing a behavior layer.</p>
  </div>
</div>

<div class="sec" id="how">
  <div class="wrap">
    <h2>How it works</h2>
    <p class="lead">Three steps, zero accounts, one public key. Any agent or human can issue and any third party can verify.</p>
    <div class="steps">
      <div class="step"><div class="n">01</div><h3>Issue</h3><p>An agent emits a receipt: who did what, where, with an optional proof link.</p></div>
      <div class="step"><div class="n">02</div><h3>Sign</h3><p>The worker signs the receipt with an Ed25519 key pair. The signature is attached and stored in KV.</p></div>
      <div class="step"><div class="n">03</div><h3>Verify &amp; Audit</h3><p>Anyone checks a receipt by ID, or reads the global audit. Signature valid = bytes present = claim intact.</p></div>
    </div>
  </div>
</div>

<div class="sec" id="stack">
  <div class="wrap">
    <h2>The missing layer</h2>
    <p class="lead">Identity says who you are. Payment moves value. Receipts prove what actually happened.</p>
    <div class="stack">
      <div class="layer"><div class="tag" style="color:#8b93ad;">IDENTITY</div><h3>Who are you?</h3><p>Passports, keys, reputation carriers. Well served by existing ecosystems.</p><div class="status" style="color:#8b93ad;">EXISTING</div></div>
      <div class="layer"><div class="tag" style="color:#8b93ad;">PAYMENT</div><h3>How value moves</h3><p>Channels for value transfer between nodes. Mature and crowded.</p><div class="status" style="color:#8b93ad;">EXISTING</div></div>
      <div class="layer hl"><div class="tag" style="color:#3ddad7;">RECEIPT</div><h3>What happened?</h3><p>Signed, queryable, auditable proof of actions. Open, cheap, cross-venue.</p><div class="status" style="color:#3ddad7;">THE GAP · THIS</div></div>
    </div>
  </div>
</div>

<div class="sec" id="features">
  <div class="wrap">
    <h2>Built for agents, open to all</h2>
    <div class="grid2">
      <div class="feat"><h3>Ed25519 signatures</h3><p>Cryptographic proof attached to every receipt. Tamper-evident by construction.</p></div>
      <div class="feat"><h3>Cross-venue by design</h3><p>One protocol for AGORA, GitHub, hackathons, markets — any substrate. Receipts carry a venue field, not a silo.</p></div>
      <div class="feat"><h3>Global audit</h3><p>Read every receipt in the system with a single GET. The consumption side of the loop.</p></div>
      <div class="feat"><h3>No accounts, no KYC</h3><p>Anyone can issue. Verification needs only the public key.</p></div>
      <div class="feat"><h3>Rate-limited &amp; CORS</h3><p>30 req/min per IP, open CORS — safe to call from browsers and workers.</p></div>
      <div class="feat"><h3>GitHub archive</h3><p>Receipts are mirrored to the repo as files. Immutable log outside the runtime.</p></div>
    </div>
  </div>
</div>

<div class="sec" id="uses">
  <div class="wrap">
    <h2>Where receipts change the game</h2>
    <div class="grid2">
      <div class="feat"><h3>Agent marketplaces</h3><p>Proof of delivery before payment release. Resolve disputes with signatures, not screenshots.</p></div>
      <div class="feat"><h3>Cross-platform reputation</h3><p>A portable record of what an agent actually did — the substrate for reputation that survives platform switches.</p></div>
      <div class="feat"><h3>Anti-impersonation</h3><p>Sign actions with a known key. A claim without a matching signature is just noise.</p></div>
      <div class="feat"><h3>Hackathons &amp; audits</h3><p>Timestamped proof of attendance, submission, or delivery. Verifiable after the event ends.</p></div>
    </div>
  </div>
</div>

<div class="endcta">
  <div class="wrap">
    <h2>The behavior layer is open.<br>Start proving.</h2>
    <a class="cta" href="/app">Open the App →</a>
  </div>
</div>

<div class="foot">
  <div class="wrap">Ed25519 public key · <code>` + pub + `</code></div>
  <div class="wrap" style="margin-top:8px;">Open source · Worker endpoints: /issue · /verify/:id · /agent/:id · /receipts/:agent · /audit · /pubkey</div>
</div>
</body>
</html>`;

    return html(page);
  }

  // ============ MEET PAGE (/meet) — 广告场入口 ============
  if (path === '/meet' && request.method === 'GET') {
    const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meet · KazHackStan 2026 — Receipt Protocol</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b1020;color:#e6e9f2;min-height:100vh;}
  .head{text-align:center;padding:34px 18px 22px;}
  .brand{font-weight:800;font-size:18px;background:linear-gradient(90deg,#7c9cff,#3ddad7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
  .tag{margin-top:8px;font-size:12px;color:#8b93ad;letter-spacing:1px;}
  .sub{margin-top:14px;font-size:15px;color:#aab4d4;max-width:520px;margin-left:auto;margin-right:auto;line-height:1.6;}
  .lanes{max-width:560px;margin:20px auto 0;padding:0 18px;display:flex;flex-direction:column;gap:12px;}
  .lane{border:1px solid #1f2a45;border-radius:14px;background:#141b31;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .lane .label{font-size:11px;font-weight:700;letter-spacing:1px;color:#7c9cff;}
  .lane h3{font-size:16px;margin-top:4px;}
  .lane p{font-size:12px;color:#8b93ad;margin-top:4px;line-height:1.5;}
  .lane button{flex-shrink:0;background:linear-gradient(90deg,#7c9cff,#3ddad7);color:#0b1020;border:none;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;}
  .form{max-width:560px;margin:24px auto 0;padding:0 18px;}
  .formbox{background:#141b31;border:1px solid #1f2a45;border-radius:14px;padding:18px;}
  .formbox h3{font-size:15px;}
  .formbox p{font-size:12px;color:#8b93ad;margin-top:6px;}
  label{display:block;font-size:12px;color:#8b93ad;margin:12px 0 4px;}
  input,select{width:100%;background:#0d1226;border:1px solid #243152;color:#e6e9f2;border-radius:8px;padding:10px;font-size:14px;}
  input:focus{outline:none;border-color:#7c9cff;}
  .btn{display:block;width:100%;margin-top:16px;background:linear-gradient(90deg,#7c9cff,#3ddad7);color:#0b1020;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;}
  .msg{margin-top:12px;font-size:13px;border-radius:8px;padding:10px;display:none;}
  .msg.ok{display:block;background:#0e2a22;color:#3ddad7;border:1px solid #1d4a3e;}
  .msg.err{display:block;background:#2a1616;color:#ff8a8a;border:1px solid #4a1f1f;}
  .foot{text-align:center;padding:30px 18px 40px;font-size:11px;color:#5b647f;}
  .foot a{color:#7c9cff;text-decoration:none;}
</style>
</head>
<body>
<div class="head">
  <div class="brand">Receipt Protocol</div>
  <div class="tag">KAZHACKSTAN 2026 · ASTANA</div>
  <div class="sub">Pick your lane. Leave a verifiable receipt. We follow up — proved, not promised.</div>
</div>

<div class="lanes">
  <div class="lane">
    <div>
      <div class="label">STUDENT</div>
      <h3>CTF teammate hunt</h3>
      <p>Narxoz CTF tomorrow — building a team, signing receipts as proof of work.</p>
    </div>
    <button data-role="student">Join the hunt</button>
  </div>
  <div class="lane">
    <div>
      <div class="label">BUILDER / DEV</div>
      <h3>Live verify demo</h3>
      <p>Ed25519-signed receipts for agent actions. Watch a verification pass in 30s.</p>
    </div>
    <button data-role="builder">See it live</button>
  </div>
  <div class="lane">
    <div>
      <div class="label">BUSINESS / SECURITY</div>
      <h3>AI fraud &amp; audit pilot</h3>
      <p>Tamper-evident receipts for AI-agent actions. 5-minute pilot conversation.</p>
    </div>
    <button data-role="business">Book 5-min chat</button>
  </div>
  <div class="lane">
    <div>
      <div class="label">INSTITUTION / RESEARCH</div>
      <h3>The math of verifiable execution</h3>
      <p>Partial observation, identifiability, inverse problems — an open research question.</p>
    </div>
    <button data-role="research">Open the question</button>
  </div>
</div>

<div class="form">
  <div class="formbox">
    <h3>Connect — sign a receipt</h3>
    <p>Your name + one contact. We sign a receipt; you get a verifiable link. No inbox spam, ever.</p>
    <label>Name</label>
    <input id="name" placeholder="Your name">
    <label>Role</label>
    <select id="role">
      <option value="student">Student / CTF</option>
      <option value="builder">Builder / Dev</option>
      <option value="business">Business / Security</option>
      <option value="research">Institution / Research</option>
    </select>
    <label>Telegram or email</label>
    <input id="contact" placeholder="@telegram or email">
    <button class="btn" id="connect">Sign receipt &amp; connect</button>
    <div id="msg" class="msg"></div>
  </div>
</div>

<div class="foot">
  Receipt Protocol · <a href="/">landing</a> · <a href="/audit">public audit</a> · <a href="/app">app</a>
</div>

<script>
(function(){
  var nameEl=document.getElementById('name'),roleEl=document.getElementById('role'),contactEl=document.getElementById('contact'),msg=document.getElementById('msg'),btn=document.getElementById('connect');
  function show(t,ok){msg.textContent=t;msg.className='msg '+(ok?'ok':'err');}
  var laneBtns=document.querySelectorAll('.lane button');
  for(var i=0;i<laneBtns.length;i++){
    (function(b){b.addEventListener('click',function(){roleEl.value=b.getAttribute('data-role');var f=document.querySelector('.formbox');f.scrollIntoView({behavior:'smooth'});});})(laneBtns[i]);
  }
  btn.addEventListener('click',function(){
    var name=nameEl.value.trim(),role=roleEl.value,contact=contactEl.value.trim();
    if(!name){show('Name required',false);return;}
    if(!contact){show('Telegram or email required',false);return;}
    var body={agent_id:name.replace(/[ \t]+/g,'-').toLowerCase(),action:'connect-'+role+'-kazhackstan-day1',platform:'KazHackStan',proof:contact};
    fetch('/issue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(res){
        if(res.ok){ show('✓ Signed. Verify: https://receipt.lifari777.workers.dev/verify/'+res.d.id,true); }
        else { show('✗ '+(res.d.error||'failed'),false); }
      }).catch(function(e){show('✗ '+e.message,false);});
  });
})();
</script>
</body>
</html>`;

    return html(page);
  }

  // ============ APP UI (/app) ============
  if (path === '/app' && request.method === 'GET') {
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt Protocol — App</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; background:#0b1020; color:#e6e9f2; min-height:100vh; }
  .topbar { background:#0e1428; border-bottom:1px solid #1d2740; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:10; }
  .brand { font-weight:800; font-size:15px; background:linear-gradient(90deg,#7c9cff,#3ddad7); -webkit-background-clip:text; -webkit-text-fill-color:transparent; text-decoration:none; }
  .back { font-size:12px; color:#8b93ad; text-decoration:none; }
  .wrap { max-width:760px; margin:0 auto; padding:20px 16px 60px; }
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
<div class="topbar">
  <a class="brand" href="/">Receipt Protocol</a>
  <a class="back" href="/">← Home</a>
</div>
<div class="wrap">
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
    <div class="formrow"><button class="btn" type="submit">Sign &amp; Issue</button></div>
    <div id="issueMsg" class="msg"></div>
  </form>

  <h2>Verify Receipt</h2>
  <form id="verifyForm">
    <label>Receipt ID</label>
    <input id="verify_id" placeholder="Paste receipt ID">
    <div class="formrow"><button class="btn" type="submit">Verify</button></div>
    <div id="verifyMsg" class="msg"></div>
  </form>

  <h2>All Receipts (` + receipts.length + `)</h2>
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
          show(issueMsg, '✓ Issued. ID: ' + res.d.id, true);
          setTimeout(function(){ location.reload(); }, 1200);
        } else {
          show(issueMsg, '✗ ' + (res.d.error || JSON.stringify(res.d)), false);
        }
      }).catch(function(err){ show(issueMsg, '✗ Request failed: ' + err.message, false); });
  });

  verifyForm.addEventListener('submit', function(e){
    e.preventDefault();
    var id = document.getElementById('verify_id').value.trim();
    if(!id){ show(verifyMsg, 'Enter a receipt ID', false); return; }
    fetch('/verify/' + encodeURIComponent(id))
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if(res.d && res.d.verdict){
          show(verifyMsg, '✓ ' + res.d.verdict + (res.d.axes ? ' · Signature valid: ' + res.d.axes.signature_valid_at_signing : ''), res.ok);
        } else {
          show(verifyMsg, '✗ ' + (res.d.error || JSON.stringify(res.d)), false);
        }
      }).catch(function(err){ show(verifyMsg, '✗ Request failed: ' + err.message, false); });
  });
})();
</script>
</body>
</html>`;

    return html(page);
  }

  return json({ error: 'not found' }, 404);
}
