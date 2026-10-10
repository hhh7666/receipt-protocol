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

// --- Attack 4: Store A, then mutate the same buffer to valid JSON B, re-store ---
{
  const buf = Buffer.alloc(256);
  const jsonA = JSON.stringify({ receipt_id: 'attack-4', value: 'before' });
  buf.write(jsonA, 0, 'utf8');
  const rawA = buf.subarray(0, Buffer.byteLength(jsonA, 'utf8'));
  const dig1 = storeReceipt(rawA).digest;
  // Mutate the same buffer: write valid JSON B over it
  const jsonB = JSON.stringify({ receipt_id: 'attack-4', value: 'after' });
  buf.write(jsonB, 0, 'utf8');
  const rawB = buf.subarray(0, Buffer.byteLength(jsonB, 'utf8'));
  const dig2 = storeReceipt(rawB).digest;
  const rA = getReceiptRaw(dig1);
  const rB = getReceiptRaw(dig2);
  check('Attack 4: A and B get different digests, both retrievable, no cross-contamination',
    rA !== null && rB !== null &&
    dig1 !== dig2 &&
    rA.toString().includes('"value":"before"') &&
    rB.toString().includes('"value":"after"'),
    `dig1=${dig1.slice(0,8)} dig2=${dig2.slice(0,8)}`);
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
  let allMatched = true;
  let firstMismatch = '';
  for (let i = 0; i < 5; i++) {
    const r = getReceiptRaw(dig);
    if (!r || sha256Hex(r) !== dig) {
      allMatched = false;
      firstMismatch = `read #${i+1} got ${r ? sha256Hex(r).slice(0,12) : 'null'}`;
      break;
    }
  }
  check('Attack 6: 5 repeated reads all hash to stored digest', allMatched, firstMismatch);
}

console.log(`\n=== Result: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'} ===`);
process.exit(failures > 0 ? 1 : 0);
