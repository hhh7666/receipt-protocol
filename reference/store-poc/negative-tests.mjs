// Negative tests for Receipt Store
import { storeReceipt, getReceiptRaw, getRelations } from './store.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vateDir = process.env.VATE_SAMPLES_DIR || join(__dirname, '..', '..', '..', 'vate-test', 'examples', 'receipts');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} — ${detail || ''}`); fail++; }
}

console.log('=== Negative Tests ===\n');

const raw = readFileSync(join(vateDir, 'post-execution-success.example.json'));

// Test 1: Byte preservation
console.log('Test 1: Byte preservation');
{
  const { digest } = storeReceipt(raw);
  const retrieved = getReceiptRaw(digest);
  check('raw bytes identical after store+retrieve', Buffer.compare(raw, retrieved) === 0);
}

// Test 2: Digest mismatch
console.log('\nTest 2: Digest mismatch');
{
  const receiptB = Buffer.from(JSON.stringify({ receipt_id: 'B-001', data: 'hello' }));
  const digestB = createHash('sha256').update(receiptB).digest('hex');
  
  const receiptA = Buffer.from(JSON.stringify({
    receipt_id: 'A-001',
    admission: { receipt_id: 'B-001', digest: { value: '0'.repeat(64) } } // WRONG digest
  }));
  
  storeReceipt(receiptB);
  const { digest: digestA } = storeReceipt(receiptA);
  
  const rel = getRelations(digestA);
  const ref = rel.relations[0];
  check('reference found in store', ref.reference_found === true);
  check('digest_match = false (tampered)', ref.digest_match === false);
  check('trust_assessed = false', ref.trust_assessed === false);
}

// Test 3: Missing reference
console.log('\nTest 3: Missing reference');
{
  const receipt = Buffer.from(JSON.stringify({
    receipt_id: 'orphan',
    admission: { receipt_id: 'does-not-exist', digest: { value: 'abc' } }
  }));
  const { digest } = storeReceipt(receipt);
  const rel = getRelations(digest);
  check('reference_found = false', rel.relations[0].reference_found === false);
  check('digest_match = false', rel.relations[0].digest_match === false);
}

// Test 4: Duplicate ingestion
console.log('\nTest 4: Duplicate ingestion');
{
  storeReceipt(raw);
  const again = storeReceipt(raw);
  check('same content returns deduped=true', again.deduped === true);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
