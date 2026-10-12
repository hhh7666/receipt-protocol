// Fail-closed integration-contract checks. Mock verifier; not official Selo validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const harness = join(dirname(fileURLToPath(import.meta.url)), 'selo-roundtrip.mjs');
const digest = 'a'.repeat(64);
const native = { receipt_id: 'regression-1', task_id: 'regression-1', receipt_hash: digest };
const statement = { _type: 'https://in-toto.io/Statement/v1',
  predicateType: 'https://selo.c1.run/attestation/v1',
  subject: [{ name: 'selo://regression-1', digest: { sha256: digest } }], predicate: native };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function runCase(change = () => {}, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'selo-boundary-'));
  try {
    const key = join(dir, 'key.pub'), nativeFile = join(dir, 'native.json');
    const dsseFile = join(dir, 'dsse.json'), mock = join(dir, 'mock.cjs');
    const keyBytes = Buffer.alloc(32, 11);
    if (!options.noKey) writeFileSync(key, options.badKey ? 'not-base64' : keyBytes.toString('base64'));
    writeFileSync(nativeFile, JSON.stringify(native));
    const stmt = structuredClone(statement);
    const env = { payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(stmt)).toString('base64'), signatures: [{ sig: 'mock-only' }] };
    change(stmt, env);
    if (!options.rawPayload) env.payload = Buffer.from(JSON.stringify(stmt)).toString('base64');
    writeFileSync(dsseFile, JSON.stringify(env));
    writeFileSync(mock, `#!/usr/bin/env node\nconst p=process.argv[3];\nconsole.log(JSON.stringify({valid:true,hash_ok:true,signature_ok:true,pubkey_pinned:true,pubkey_match:true,provenance:'PINNED',format:p.includes('dsse')?'in-toto/DSSE':'receipt',errors:[]}));`, { mode: 0o755 });
    const out = join(dir, 'out');
    const args = [harness, '--native', nativeFile, '--dsse', dsseFile, '--selo', mock,
      '--pubkey', key, '--pin-fingerprint', options.pin ?? sha(keyBytes), '--out', out];
    const proc = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
    let report = null;
    try { report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')); } catch { /* expected for preflight failure */ }
    return { proc, report };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('valid mock baseline (not cryptographic validation)', () => {
  const { proc, report } = runCase();
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(report?.pass, true);
});
for (const [name, options] of [
  ['wrong independently supplied pin', { pin: '0'.repeat(64) }],
  ['invalid fingerprint format', { pin: 'not-a-digest' }],
  ['missing trusted public key', { noKey: true }],
  ['invalid Ed25519 key encoding', { badKey: true }]
]) test(name + ' fails before storing', () => {
  const { proc, report } = runCase(() => {}, options);
  assert.notEqual(proc.status, 0);
  assert.equal(report, null);
});
for (const [name, mutate] of [
  ['subject digest mismatch', stmt => { stmt.subject[0].digest.sha256 = 'b'.repeat(64); }],
  ['subject name mismatch', stmt => { stmt.subject[0].name = 'selo://other'; }],
  ['predicate mismatch', stmt => { stmt.predicate = { ...native, verdict: 'invented' }; }],
  ['predicate type mismatch', stmt => { stmt.predicateType = 'invalid'; }],
  ['payload type mismatch', (_stmt, env) => { env.payloadType = 'wrong/type'; }],
  ['missing envelope signatures', (_stmt, env) => { env.signatures = []; }]
]) test(name + ' rejected despite positive mock verdict', () => {
  const { proc, report } = runCase(mutate);
  assert.equal(proc.status, 1, proc.stderr);
  assert.equal(report?.semantic.pass, false);
  assert.equal(report?.pass, false);
  assert(report?.cases.every(c => c.original.pass && c.replay.pass));
});
