// Receipt Store / Resolve — minimal format-agnostic POC
// Stores receipts as opaque bytes, indexes them by content digest.
// Does NOT sign, modify, or make trust decisions.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Digest: we hash the raw bytes as received, not a re-serialized object ----
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Canonical form for structured data (loose, POC-grade — not RFC 8785 JCS)
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function digestObject(obj) {
  return sha256Hex(Buffer.from(stableStringify(obj)));
}

// ---- Store: digest -> { rawBytes, parsed, txId, issuer, storedAt } ----
const store = new Map();
const byTx = new Map();

function storeReceipt(rawBytes) {
  const digest = sha256Hex(rawBytes);
  if (store.has(digest)) return { digest, deduped: true };

  const parsed = JSON.parse(rawBytes.toString('utf8'));
  const issuer = parsed.issuer?.id || parsed.actor || parsed.agent_id || 'unknown';
  const txId = parsed.execution?.transaction_id || parsed.transaction_id || parsed.id || 'unknown';

  store.set(digest, { rawBytes, parsed, txId, issuer, storedAt: new Date().toISOString() });
  if (!byTx.has(txId)) byTx.set(txId, new Set());
  byTx.get(txId).add(digest);
  return { digest, deduped: false, txId, issuer };
}

function getReceiptRaw(digest) {
  return store.get(digest)?.rawBytes || null;
}

function queryByTx(txId) {
  return [...(byTx.get(txId) || [])].map(d => ({
    digest: d,
    parsed: store.get(d).parsed
  }));
}

function getRelations(digest) {
  const entry = store.get(digest);
  if (!entry) return null;
  const related = [];
  const r = entry.parsed;

  // Outgoing: this receipt references another
  if (r.admission?.receipt_id) {
    const refDigest = r.admission.digest?.value;
    let found = false, match = false;
    for (const [d, e] of store) {
      if (e.parsed.receipt_id === r.admission.receipt_id) {
        found = true;
        match = d === refDigest;
        break;
      }
    }
    related.push({
      direction: 'outgoing',
      relation: 'admission',
      referenced_id: r.admission.receipt_id,
      reference_found: found,
      digest_match: match,
      trust_assessed: false
    });
  }
  return { digest, txId: entry.txId, issuer: entry.issuer, relations: related };
}

// ---- Demo: load VATE samples from a path passed as CLI arg ----
const samplesDir = process.argv[2];
if (samplesDir) {
  const files = readdirSync(samplesDir).filter(f => f.endsWith('.json'));
  let stored = 0;
  for (const f of files) {
    const raw = readFileSync(join(samplesDir, f));
    storeReceipt(raw);
    stored++;
  }
  console.log(`Loaded ${stored} receipts, ${store.size} unique digests`);

  // Show tx query
  const txResults = queryByTx('txn-20260504-001');
  console.log(`\nQuery txn-20260504-001: ${txResults.length} receipts`);
  txResults.forEach(r => console.log(`  - ${r.parsed.receipt_id}`));

  // Show relations
  const postExec = [...store.values()].find(e => e.parsed.receipt_id === 'postrec-20260504-001');
  if (postExec) {
    const rel = getRelations([...store.entries()].find(([d,e]) => e === postExec)[0]);
    console.log(`\nRelations for ${postExec.parsed.receipt_id}:`);
    rel.relations.forEach(r => console.log(`  - [${r.direction}] ${r.relation}: ${r.referenced_id} (found=${r.reference_found}, match=${r.digest_match})`));
  }
}

export { storeReceipt, getReceiptRaw, queryByTx, getRelations, digestObject };
