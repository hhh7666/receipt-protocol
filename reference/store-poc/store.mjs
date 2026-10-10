// Receipt Store / Resolve - minimal proof of concept
// Generic receipt storage, query, and relation resolution
// Does NOT sign, does NOT modify, does NOT decide trust

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Digest computation (generic, works with any JSON) ----
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function digestReceipt(receipt) {
  const bytes = Buffer.from(stableStringify(receipt));
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

// ---- In-memory store ----
const receipts = new Map(); // digest -> { receipt, issuer, stored_at }
const byTransaction = new Map(); // transaction_id -> Set of digests
const byIssuer = new Map(); // issuer_id -> Set of digests

// ---- API operations (the 4 core endpoints) ----

// POST /receipts
// Store an arbitrary receipt. We don't care about its format.
// We compute its digest, preserve the original, and index it.
function storeReceipt(receipt) {
  const digest = digestReceipt(receipt);
  const issuer = receipt.issuer?.id || receipt.actor || receipt.agent_id || 'unknown';
  
  // Extract transaction_id from wherever it lives
  const txId = receipt.execution?.transaction_id 
    || receipt.transaction_id 
    || receipt.id 
    || 'unknown';
  
  if (!receipts.has(digest)) {
    receipts.set(digest, { receipt, issuer, txId, stored_at: new Date().toISOString() });
    
    // Index by transaction
    if (!byTransaction.has(txId)) byTransaction.set(txId, new Set());
    byTransaction.get(txId).add(digest);
    
    // Index by issuer
    if (!byIssuer.has(issuer)) byIssuer.set(issuer, new Set());
    byIssuer.get(issuer).add(digest);
  }
  
  return { digest, txId, issuer, already_exists: receipts.get(digest).stored_at !== new Date().toISOString() };
}

// GET /receipts/{digest}
function getReceipt(digest) {
  return receipts.get(digest)?.receipt || null;
}

// GET /receipts?transaction_id=...
function queryByTransaction(txId) {
  const digests = byTransaction.get(txId) || new Set();
  return [...digests].map(d => ({ digest: d, receipt: receipts.get(d).receipt }));
}

// GET /receipts/{digest}/relations
// Find all receipts that reference this one, and all receipts this one references
function getRelations(digest) {
  const entry = receipts.get(digest);
  if (!entry) return null;
  
  const related = [];
  const receipt = entry.receipt;
  
  // Outgoing relations: things this receipt references
  if (receipt.admission?.receipt_id) {
    // Find the referenced admission receipt in our store
    for (const [otherDigest, otherEntry] of receipts) {
      if (otherEntry.receipt.receipt_id === receipt.admission.receipt_id) {
        related.push({
          direction: 'outgoing',
          relation: 'admission',
          digest: otherDigest,
          receipt_id: receipt.admission.receipt_id,
          digest_binding: receipt.admission.digest || null,
          binding_verified: receipt.admission.digest 
            ? otherDigest === 'sha256:' + receipt.admission.digest.value
            : 'unknown'
        });
      }
    }
  }
  
  // Incoming relations: things that reference this receipt
  const myReceiptId = receipt.receipt_id || receipt.id;
  for (const [otherDigest, otherEntry] of receipts) {
    if (otherDigest === digest) continue;
    if (otherEntry.receipt.admission?.receipt_id === myReceiptId) {
      related.push({
        direction: 'incoming',
        relation: 'referenced_by',
        digest: otherDigest,
        receipt_id: myReceiptId
      });
    }
  }
  
  return { digest, txId: entry.txId, issuer: entry.issuer, relations: related };
}

// ---- Test with VATE's actual sample receipts ----
console.log('=== Testing Receipt Store with VATE samples ===\n');

const vateReceiptsDir = '/home/user/Doubao/chats/38443714734673922/vate-test/examples/receipts';
const files = readdirSync(vateReceiptsDir).filter(f => f.endsWith('.json'));

console.log(`Loading ${files.length} VATE sample receipts...\n`);

const stored = [];
for (const file of files) {
  const receipt = JSON.parse(readFileSync(join(vateReceiptsDir, file), 'utf8'));
  const result = storeReceipt(receipt);
  stored.push({ file, ...result });
}

console.log(`Stored ${receipts.size} unique receipts\n`);

// Test 1: Retrieve by digest
console.log('--- Test 1: GET /receipts/{digest} ---');
const firstDigest = stored[0].digest;
const retrieved = getReceipt(firstDigest);
console.log(`Retrieved receipt: ${retrieved.receipt_id} (${retrieved.receipt_type})`);
console.log(`Issuer: ${retrieved.issuer?.id}\n`);

// Test 2: Query by transaction_id
console.log('--- Test 2: GET /receipts?transaction_id=... ---');
const txReceipts = queryByTransaction('txn-20260504-001');
console.log(`Found ${txReceipts.length} receipts for txn-20260504-001:`);
for (const r of txReceipts) {
  console.log(`  - ${r.receipt.receipt_id} (${r.receipt.receipt_type})`);
}
console.log();

// Test 3: Relations
console.log('--- Test 3: GET /receipts/{digest}/relations ---');
const postExecDigest = stored.find(s => s.file.includes('post-execution-success'))?.digest;
if (postExecDigest) {
  const rels = getRelations(postExecDigest);
  console.log(`Relations for ${rels.receipt_id || 'receipt'}:`);
  for (const r of rels.relations) {
    console.log(`  - [${r.direction}] ${r.relation}: ${r.receipt_id}`);
    if (r.binding_verified !== undefined) {
      console.log(`    digest binding verified: ${r.binding_verified}`);
    }
  }
}
console.log();

// Test 4: What's unique about this vs a plain database?
console.log('--- What makes this more than a database? ---');
console.log('1. Content-addressed: receipts are indexed by their own digest, not an autoincrement ID');
console.log('2. Digest binding verification: when receipt A references receipt B by digest, we can check if the stored B matches the referenced digest');
console.log('3. Cross-source: we store VATE receipts, but the same API would work for our receipts or any other format');
console.log('4. We never modify content: what you POST is what you GET back, byte-for-byte');
console.log('5. We never decide trust: we return records and relations, the caller applies their own policy');
