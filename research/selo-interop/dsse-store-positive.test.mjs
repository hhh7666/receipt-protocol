#!/usr/bin/env node
// Synthetic DSSE positive control: byte preservation and independently pinned key.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { storeReceipt, getReceiptRaw } from '../../reference/store-poc/store.mjs';
const digest = x => createHash('sha256').update(x).digest('hex');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const type = 'application/vnd.in-toto+json';
const payload = Buffer.from(JSON.stringify({ _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'selo://synthetic-task', digest: { sha256: 'a'.repeat(64) } }],
  predicateType: 'https://selo.c1.run/attestation/v1', predicate: { task_id: 'synthetic-task' }
}, null, 2));
const pae = Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${payload.length} `), payload]);
const signature = sign(null, pae, privateKey);
const envelope = { payloadType: type, payload: payload.toString('base64'),
  signatures: [{ sig: signature.toString('base64') }] };
const bytes = Buffer.from(JSON.stringify(envelope));
const stored = storeReceipt(bytes);
const retrieved = getReceiptRaw(stored.digest);
assert.deepEqual(retrieved, bytes);
assert.equal(digest(retrieved), stored.digest);
const parsed = JSON.parse(retrieved.toString());
const retrievedPayload = Buffer.from(parsed.payload, 'base64');
const retrievedPae = Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${retrievedPayload.length} `), retrievedPayload]);
assert.equal(verify(null, retrievedPae, publicKey, Buffer.from(parsed.signatures[0].sig, 'base64')), true);
assert.deepEqual(retrievedPayload, payload);
console.log('PASS: synthetic DSSE raw bytes -> Store API -> retrieval -> pinned Ed25519 verification');
