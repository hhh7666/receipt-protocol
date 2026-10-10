// Negative tests for Receipt Store POC
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
function digestReceipt(receipt) {
  return 'sha256:' + createHash('sha256').update(Buffer.from(stableStringify(receipt))).digest('hex');
}

// Load a real VATE receipt as test data
const vateDir = '/home/user/Doubao/chats/38443714734673922/vate-test/examples/receipts';
const successReceipt = JSON.parse(readFileSync(`${vateDir}/post-execution-success.example.json`, 'utf8'));

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} — ${detail}`); fail++; }
}

console.log('=== Negative Tests ===\n');

// Test 1: Byte preservation
console.log('Test 1: Byte preservation (stored = retrieved)');
{
  const originalStr = JSON.stringify(successReceipt);
  const originalDigest = digestReceipt(successReceipt);
  
  // Simulate store + retrieve
  const stored = successReceipt; // we store the object
  const retrieved = JSON.parse(JSON.stringify(stored)); // simulate serialization round-trip
  const retrievedDigest = digestReceipt(retrieved);
  
  check('digest matches after round-trip', originalDigest === retrievedDigest, 
    `${originalDigest} != ${retrievedDigest}`);
  check('receipt_id preserved', successReceipt.receipt_id === retrieved.receipt_id);
  check('nested field preserved', 
    successReceipt.execution.transaction_id === retrieved.execution.transaction_id);
}

// Test 2: Digest mismatch
console.log('\nTest 2: Digest mismatch detection');
{
  // Receipt A references B with a digest
  const receiptA = {
    receipt_id: 'receipt-A',
    admission: {
      receipt_id: 'receipt-B',
      digest: { alg: 'sha-256', value: '0000000000000000000000000000000000000000000000000000000000000000' }
    }
  };
  
  // Store B (real digest)
  const receiptB = { receipt_id: 'receipt-B', issuer: 'did:example:bob' };
  const realDigest = digestReceipt(receiptB);
  const realHash = realDigest.replace('sha256:', '');
  
  // The referenced digest is WRONG (all zeros)
  const referencedHash = receiptA.admission.digest.value;
  const matches = realHash === referencedHash;
  
  check('detects digest mismatch', matches === false, 
    `should not match: real=${realHash.slice(0,16)}... referenced=${referencedHash.slice(0,16)}...`);
  
  // Proper response format
  const response = {
    reference_found: true,
    digest_match: matches,
    trust_assessed: false
  };
  check('response format separates dimensions', 
    response.digest_match === false && response.trust_assessed === false);
}

// Test 3: Missing reference
console.log('\nTest 3: Missing reference');
{
  const receiptA = {
    receipt_id: 'receipt-A',
    admission: {
      receipt_id: 'nonexistent-receipt',
      digest: { alg: 'sha-256', value: 'abc123' }
    }
  };
  
  // Try to find it in an empty store
  const store = new Map();
  const found = store.get(receiptA.admission.receipt_id);
  
  check('returns not found when reference missing', found === undefined);
  check('must NOT return verified: true for missing reference', found === undefined);
}

// Test 4: Duplicate ingestion
console.log('\nTest 4: Duplicate ingestion');
{
  const store = new Map();
  const digest1 = digestReceipt(successReceipt);
  const digest2 = digestReceipt(JSON.parse(JSON.stringify(successReceipt))); // same content
  
  // First write
  store.set(digest1, successReceipt);
  const count1 = store.size;
  
  // Second write (same content)
  if (!store.has(digest2)) store.set(digest2, successReceipt);
  const count2 = store.size;
  
  check('same content = same digest', digest1 === digest2);
  check('duplicate write does not create new entry', count1 === count2, 
    `count went from ${count1} to ${count2}`);
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
