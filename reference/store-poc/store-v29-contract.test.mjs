// Regression contract for v2.9 relation binding. Uses the real in-memory Store API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const saved = process.argv[2]; process.argv[2] = '';
const { storeReceipt, getReceiptRaw, getRelations, queryByTx } = await import('./store.mjs');
process.argv[2] = saved;
const encode = x => Buffer.from(JSON.stringify(x));
let n = 0;
function relation(content_digest, expected, include = true) {
  const id = 'target-' + (++n);
  const bytes = encode({ id, action: 'test' });
  const stored = storeReceipt(bytes);
  assert.deepEqual(getReceiptRaw(stored.digest), bytes);
  const link = { id, relationship: 'admission' };
  if (include) link.content_digest = content_digest;
  const source = storeReceipt(encode({ id: 'source-' + n, related_receipts: [link] }));
  const result = getRelations(source.digest).relations[0];
  assert.equal(result.reference_found, true);
  assert.equal(result.binding_status, expected);
  assert.equal(result.trust_assessed, false);
  return result;
}
const digest = 'a'.repeat(64);
test('id-only reference is not a digest match', () => {
  assert.equal(relation(undefined, 'resolved_no_digest', false).digest_match, null);
});
test('explicit raw-byte digest binds stored bytes', () => {
  const id = 'match-' + (++n);
  const bytes = encode({ id });
  const target = storeReceipt(bytes);
  const source = storeReceipt(encode({ id: 'source-' + n, related_receipts: [
    { id, content_digest: { algorithm: 'sha256', profile: 'raw-bytes', value: target.digest } }
  ] }));
  const r = getRelations(source.digest).relations[0];
  assert.equal(r.binding_status, 'digest_matched');
  assert.equal(r.digest_match, true);
});
test('mismatching digest is not accepted', () => {
  assert.equal(relation({ algorithm: 'sha256', profile: 'raw-bytes', value: digest }, 'digest_mismatch').digest_match, false);
});
test('malformed digest is not silently treated as absent', () => {
  relation({ algorithm: 'sha256', profile: 'raw-bytes', value: 'oops' }, 'invalid_content_digest');
});
test('empty digest object is invalid', () => relation({}, 'invalid_content_digest'));
test('profile must be explicit', () => relation({ algorithm: 'sha256', value: digest }, 'unsupported_digest_profile'));
test('unknown algorithm cannot bind', () => relation({ algorithm: 'sha512', profile: 'raw-bytes', value: digest }, 'unsupported_digest_profile'));
test('unknown profile cannot bind', () => relation({ algorithm: 'sha256', profile: 'jcs', value: digest }, 'unsupported_digest_profile'));
test('legacy receipt_id remains addressable', () => {
  const id = 'legacy-' + (++n);
  storeReceipt(encode({ receipt_id: id }));
  const source = storeReceipt(encode({ related_receipts: [{ id }] }));
  assert.equal(getRelations(source.digest).relations[0].reference_found, true);
});
test('unknown receipt cannot claim binding', () => {
  const source = storeReceipt(encode({ related_receipts: [{ id: 'absent-' + (++n) }] }));
  const r = getRelations(source.digest).relations[0];
  assert.equal(r.reference_found, false);
  assert.equal(r.binding_status, 'reference_not_found');
});

test('duplicate receipt IDs bind only the matching raw-byte candidate', () => {
  const id = 'duplicate-' + (++n);
  const first = storeReceipt(encode({ id, payload: 'first' }));
  const second = storeReceipt(encode({ id, payload: 'second' }));
  const good = storeReceipt(encode({ id: 'source-' + n, related_receipts: [
    { id, content_digest: { algorithm: 'sha256', profile: 'raw-bytes', value: second.digest } }
  ] }));
  const matched = getRelations(good.digest).relations[0];
  assert.equal(matched.candidate_count, 2);
  assert.equal(matched.binding_status, 'digest_matched');
  assert.equal(matched.digest_match, true);
  const wrong = storeReceipt(encode({ id: 'source-wrong-' + n, related_receipts: [
    { id, content_digest: { algorithm: 'sha256', profile: 'raw-bytes', value: digest } }
  ] }));
  const rejected = getRelations(wrong.digest).relations[0];
  assert.equal(rejected.candidate_count, 2);
  assert.equal(rejected.binding_status, 'digest_mismatch');
  assert.equal(rejected.digest_match, false);
});

test('store preserves original bytes despite caller and retrieval buffer mutations', () => {
  const raw = encode({ id: 'immutable-' + (++n), value: 'original' });
  const original = Buffer.from(raw);
  const saved = storeReceipt(raw);
  raw.fill(0);
  const retrieved = getReceiptRaw(saved.digest);
  assert.deepEqual(retrieved, original);
  retrieved.fill(0);
  assert.deepEqual(getReceiptRaw(saved.digest), original);
});

test('transaction queries cannot mutate stored relation evidence', () => {
  const id = 'query-mutation-' + (++n);
  const target = storeReceipt(encode({ id: 'query-target-' + n }));
  const source = storeReceipt(encode({ id, transaction_id: 'tx-' + n,
    related_receipts: [{ id: 'query-target-' + n,
      content_digest: { algorithm: 'sha256', profile: 'raw-bytes', value: target.digest } }] }));
  const before = getRelations(source.digest);
  assert.equal(before.relations[0].binding_status, 'digest_matched');
  const queried = queryByTx('tx-' + n)[0].parsed;
  queried.related_receipts[0].content_digest.value = '0'.repeat(64);
  queried.related_receipts.push({ id: 'forged' });
  assert.deepEqual(getRelations(source.digest), before);
  assert.equal(queryByTx('tx-' + n)[0].parsed.related_receipts.length, 1);
});
