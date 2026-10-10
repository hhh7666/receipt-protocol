// Self-contained regression tests: no VATE checkout required.
import { storeReceipt, getReceiptRaw, getRelations, queryByTx } from './store.mjs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  fn();
  console.log('PASS:', name);
  passed++;
}
const encode = obj => Buffer.from(JSON.stringify(obj));
const sha = b => createHash('sha256').update(b).digest('hex');
const rawRef = (id, digest) => ({
  receipt_id: id, digest: { alg: 'sha256', profile: 'raw-bytes', value: digest }
});
const receipt = encode({ receipt_id: 'roundtrip', transaction_id: 'tx-1', payload: 'hello' });
const { digest } = storeReceipt(receipt);

test('byte-preserving retrieval', () => assert.deepEqual(getReceiptRaw(digest), receipt));
test('content-addressed digest', () => assert.equal(digest, sha(receipt)));
test('transaction query', () => assert.ok(queryByTx('tx-1').some(x => x.digest === digest)));
test('duplicate ingestion', () => assert.equal(storeReceipt(receipt).deduped, true));

const first = encode({ receipt_id: 'shared-id', payload: 'first' });
const second = encode({ receipt_id: 'shared-id', payload: 'second' });
storeReceipt(first);
const secondDigest = storeReceipt(second).digest;
const link = storeReceipt(encode({
  receipt_id: 'link', admission: rawRef('shared-id', secondDigest)
})).digest;
test('multiple candidates resolve by digest, not insertion order', () => {
  const r = getRelations(link).relations[0];
  assert.equal(r.reference_found, true);
  assert.equal(r.candidate_count, 2);
  assert.equal(r.digest_match, true);
  assert.equal(r.binding_status, 'matched');
  assert.equal(r.trust_assessed, false);
});

const mismatch = storeReceipt(encode({
  receipt_id: 'bad-link', admission: rawRef('shared-id', '0'.repeat(64))
})).digest;
test('explicit raw-byte mismatch', () => {
  const r = getRelations(mismatch).relations[0];
  assert.equal(r.binding_status, 'mismatch');
  assert.equal(r.digest_match, false);
});

const unknown = storeReceipt(encode({
  receipt_id: 'unsupported-link',
  admission: { receipt_id: 'shared-id', digest: { alg: 'sha256', value: secondDigest } }
})).digest;
test('undeclared source digest profile is not assessed', () => {
  const r = getRelations(unknown).relations[0];
  assert.equal(r.binding_status, 'not_assessed');
  assert.equal(r.digest_match, null);
  assert.equal(r.reason, 'unsupported_digest_profile');
});

const missing = storeReceipt(encode({
  receipt_id: 'missing-link', admission: rawRef('nonexistent-id', '0'.repeat(64))
})).digest;
test('missing reference is not assessed', () => {
  const r = getRelations(missing).relations[0];
  assert.equal(r.reference_found, false);
  assert.equal(r.digest_match, null);
  assert.equal(r.binding_status, 'not_assessed');
});

test('missing receipt returns null', () => assert.equal(getRelations('0'.repeat(64)), null));
console.log(`All ${passed} tests passed`);
