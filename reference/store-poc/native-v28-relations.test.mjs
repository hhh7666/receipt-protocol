#!/usr/bin/env node
// Native v2.8 typed relation resolution. Reference presence != authorization.
import assert from 'node:assert/strict';
import { storeReceipt, getReceiptRaw, getRelations } from './store.mjs';
const encode = obj => Buffer.from(JSON.stringify(obj));
const admission = { schema_version: '2.8', id: 'admit-001', agent_id: 'agent-a',
  action: 'allow-task', platform: 'test', outcome: 'success', trust_level: 'self_attested' };
const exec = { schema_version: '2.8', id: 'execute-001', agent_id: 'agent-a',
  action: 'perform-task', platform: 'test', outcome: 'success', trust_level: 'self_attested',
  related_receipts: [{ id: 'admit-001', relationship: 'admission', digest: 'abc' },
    { id: 'missing-001', relationship: 'previous', digest: null }] };
const a = storeReceipt(encode(admission));
const e = storeReceipt(encode(exec));
assert.deepEqual(getReceiptRaw(e.digest), encode(exec));
const relations = getRelations(e.digest).relations;
assert.equal(relations.length, 2);
assert.deepEqual(relations.map(x => [x.relation, x.reference_found, x.binding_status, x.trust_assessed]), [
  ['admission', true, 'not_assessed', false],
  ['previous', false, 'not_assessed', false]
]);
assert.equal(relations[0].reason, 'digest_profile_unspecified');
assert.equal(relations[1].reason, 'reference_not_found');
storeReceipt(encode({ ...admission, agent_id: 'different-agent' }));
assert.equal(getRelations(e.digest).relations[0].candidate_count, 2);
console.log(JSON.stringify({ status: 'PASS', checks: 7, native_link_found: true,
  binding: 'not_assessed', trust_assessed: false, ambiguous_ids_reported: true }));
