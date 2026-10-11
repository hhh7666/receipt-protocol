// Test: content_digest binding in related_receipts (RP v2.9)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeReceipt, getReceiptRaw, getRelations } from './store.mjs';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exDir = join(__dirname, 'examples', 'rp-pair');

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, info || ''); }
}

// Fixture: admission
const admRaw = readFileSync(join(exDir, 'admission.json'));
const admDigest = createHash('sha256').update(admRaw).digest('hex');
storeReceipt(admRaw);

// Test 1: post with correct digest → digest_matched
{
  const postRaw = readFileSync(join(exDir, 'post.json'));
  const post = storeReceipt(postRaw);
  const rel = getRelations(post.digest);
  const r = rel.relations[0];
  check('Test 1: correct content_digest → digest_matched',
    r.digest_match === true && r.binding_status === 'digest_matched',
    JSON.stringify(r));
}

// Test 2: post with wrong digest → digest_mismatch
{
  const post = JSON.parse(readFileSync(join(exDir, 'post.json'), 'utf8'));
  post.related_receipts[0].content_digest.value = 'deadbeef'.repeat(8);
  const badPost = Buffer.from(JSON.stringify(post));
  const bad = storeReceipt(badPost);
  const rel = getRelations(bad.digest);
  const r = rel.relations[0];
  check('Test 2: wrong digest → digest_mismatch',
    r.digest_match === false && r.binding_status === 'digest_mismatch',
    JSON.stringify(r));
}

// Test 3: post without content_digest → resolved_no_digest (backward compat)
{
  const post = JSON.parse(readFileSync(join(exDir, 'post.json'), 'utf8'));
  delete post.related_receipts[0].content_digest;
  const noDigest = Buffer.from(JSON.stringify(post));
  const r = storeReceipt(noDigest);
  const rel = getRelations(r.digest);
  const rel0 = rel.relations[0];
  check('Test 3: missing content_digest → resolved_no_digest (backward compat)',
    rel0.binding_status === 'resolved_no_digest' && rel0.digest_match === null,
    JSON.stringify(rel0));
}

// Test 4: post referencing non-existent admission → reference_not_found
{
  const post = {
    schema_version: '2.9', receipt_id: 'orphan-post',
    related_receipts: [{ id: 'no-such-id', relationship: 'admission',
      content_digest: { algorithm: 'sha256', profile: 'raw-bytes', value: 'a'.repeat(64) } }]
  };
  const r = storeReceipt(Buffer.from(JSON.stringify(post)));
  const rel = getRelations(r.digest);
  check('Test 4: missing target → reference_not_found',
    rel.relations[0].binding_status === 'reference_not_found',
    JSON.stringify(rel.relations[0]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
