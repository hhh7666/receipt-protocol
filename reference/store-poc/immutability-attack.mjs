// Frontier Attack: Content-addressed immutability under arbitrary caller mutation
// Auditor: prove whether external callers can corrupt stored bytes via mutable references.
import { createHash } from 'node:crypto';
import { storeReceipt, getReceiptRaw } from './store.mjs';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function sha256Hex(b) { return createHash('sha256').update(b).digest('hex'); }

console.log('=== Immutability Attack ===\n');

// --- Attack 1: Mutate input buffer AFTER storeReceipt ---
{
  const original = Buffer.from(JSON.stringify({ receipt_id: 'attack-1', value: 'hello' }));
  const expectedDigest = sha256Hex(original);
  storeReceipt(original);
  // Caller mutates the buffer they passed in
  original.write('X', 0);
  const retrieved = getReceiptRaw(expectedDigest);
  check('Attack 1: input mutation after store does not corrupt stored bytes',
    retrieved !== null && retrieved[0] === Buffer.from('{')[0] && sha256Hex(retrieved) === expectedDigest,
    `retrieved[0]=${retrieved?.[0]}, expected={`);
}

// --- Attack 2: Mutate returned buffer AFTER getReceiptRaw ---
{
  const data = Buffer.from(JSON.stringify({ receipt_id: 'attack-2', value: 'world' }));
  const dig = storeReceipt(data).digest;
  const retrieved = getReceiptRaw(dig);
  const firstByte = retrieved[0];
  // Caller mutates what they got back
  retrieved.write('Y', 0);
  const secondFetch = getReceiptRaw(dig);
  check('Attack 2: mutation of returned buffer does not corrupt internal state',
    secondFetch !== null && secondFetch[0] === firstByte && sha256Hex(secondFetch) === dig,
    `secondFetch[0]=${secondFetch?.[0]}, expected=${firstByte}`);
}

// --- Attack 3: Same digest, repeated reads always return same bytes ---
{
  const data = Buffer.from(JSON.stringify({ receipt_id: 'attack-3', value: 'repeat' }));
  const dig = storeReceipt(data).digest;
  const r1 = getReceiptRaw(dig);
  const r2 = getReceiptRaw(dig);
  const r3 = getReceiptRaw(dig);
  check('Attack 3: repeated reads return identical content',
    r1.equals(r2) && r2.equals(r3));
}

// --- Attack 4: Store a receipt, then mutate input and re-store — must dedup by original digest ---
{
  const data = Buffer.from(JSON.stringify({ receipt_id: 'attack-4', value: 'before' }));
  const dig1 = storeReceipt(data).digest;
  // Mutate and try to store again (may produce invalid JSON — that's fine, we test isolation)
  data.write('ZZZZ', 0);
  let r2;
  try { r2 = storeReceipt(data); } catch { r2 = { deduped: false, errored: true }; }
  // dig1 should still be retrievable and unchanged
  const r1 = getReceiptRaw(dig1);
  check('Attack 4: mutated re-store does not overwrite original',
    r1 !== null && r1.toString().includes('before'),
    `r1 contains 'before'=${r1?.toString().includes('before')}`);
}

// --- Attack 5: Shared ArrayBuffer views ---
{
  const buf = Buffer.from(JSON.stringify({ receipt_id: 'attack-5', value: 'shared' }));
  const view1 = Buffer.from(buf.buffer, buf.byteOffset, buf.length);
  const dig = storeReceipt(view1).digest;
  // Mutate via the original underlying buffer
  buf.write('Z', 0);
  const retrieved = getReceiptRaw(dig);
  check('Attack 5: shared ArrayBuffer mutation does not leak through',
    retrieved !== null && retrieved[0] === Buffer.from('{')[0],
    `retrieved[0]=${retrieved?.[0]}`);
}

// --- Attack 6: Recompute SHA-256 of returned bytes always matches stored digest ---
{
  const data = Buffer.from(JSON.stringify({ receipt_id: 'attack-6', value: 'integrity' }));
  const dig = storeReceipt(data).digest;
  for (let i = 0; i < 5; i++) {
    const r = getReceiptRaw(dig);
    if (sha256Hex(r) !== dig) {
      check(`Attack 6: read #${i+1} hash matches digest`, false, `got ${sha256Hex(r).slice(0,12)}`);
    }
  }
  check('Attack 6: 5 repeated reads all hash to stored digest', true);
}

console.log(`\n=== Result: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'} ===`);
process.exit(failures > 0 ? 1 : 0);
