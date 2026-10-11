#!/usr/bin/env node
// Selo native + DSSE -> real Receipt Protocol Store API -> retrieval -> Selo verifier.
// Node >=18. --native FILE --dsse FILE --selo BIN --pubkey TRUSTED_KEY [--out DIR]
// A harness PASS is not proof of Selo interoperability until run with authentic signed fixtures.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const argv = process.argv.slice(2);
const opts = {};
if (argv.length % 2) throw Error('Expected --key value pairs');
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--') || !argv[i + 1]) throw Error('Invalid option pair');
  opts[argv[i].slice(2)] = argv[i + 1];
}
for (const key of ['native', 'dsse', 'selo', 'pubkey'])
  if (!opts[key]) throw Error('Required: --' + key);
const out = resolve(opts.out || './selo-interop-output');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// The existing store.mjs runs a CLI sample demo when process.argv[2] is set.
// Suppress that CLI-only side effect while importing the UNMODIFIED real Store.
const savedArg = process.argv[2];
process.argv[2] = '';
let storeReceipt, getReceiptRaw;
try {
  ({ storeReceipt, getReceiptRaw } = await import('../../reference/store-poc/store.mjs'));
} finally {
  process.argv[2] = savedArg;
}

function verify(path, expectedFormat) {
  const run = spawnSync(opts.selo, ['verify', path, '--pubkey', opts.pubkey, '--json'],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  let result = null;
  try { result = JSON.parse(run.stdout); } catch { /* fail closed */ }
  const pass = run.status === 0 && !run.error && result?.valid === true &&
    result?.hash_ok === true && result?.signature_ok === true &&
    result?.pubkey_pinned === true && result?.pubkey_match === true &&
    result?.provenance === 'PINNED' && result?.format === expectedFormat &&
    Array.isArray(result?.errors) && result.errors.length === 0;
  return { exit: run.status, error: run.error?.message || null,
    result, stderr: run.stderr || '', pass };
}

const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
const PREDICATE_TYPE = 'https://selo.c1.run/attestation/v1';
function semanticCheck(envelope, native) {
  const reasons = [];
  if (envelope.payloadType !== 'application/vnd.in-toto+json') reasons.push('payloadType');
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0)
    reasons.push('signatures');
  let statement = null;
  try {
    const bytes = Buffer.from(envelope.payload, 'base64');
    if (!bytes.length || bytes.toString('base64') !== envelope.payload)
      throw Error('non-canonical base64');
    statement = JSON.parse(bytes.toString('utf8'));
  } catch { reasons.push('payload_decode'); }
  if (statement) {
    if (statement._type !== STATEMENT_TYPE) reasons.push('_type');
    if (statement.predicateType !== PREDICATE_TYPE) reasons.push('predicateType');
    if (!isDeepStrictEqual(statement.predicate, native)) reasons.push('predicate_native_mismatch');
    const expectedDigest = native.diff_hash || native.receipt_hash;
    const expectedName = 'selo://' + (native.task_id || native.receipt_id);
    const subject = statement.subject?.[0];
    if (!/^[a-f0-9]{64}$/.test(expectedDigest || '') ||
        !Array.isArray(statement.subject) || statement.subject.length !== 1 ||
        subject?.name !== expectedName ||
        !subject.digest || Object.keys(subject.digest).length !== 1 ||
        subject.digest.sha256 !== expectedDigest)
      reasons.push('subject_binding');
  }
  return { pass: reasons.length === 0, reasons, statement };
}

await mkdir(out, { recursive: true });
const rawNative = await readFile(opts.native);
const rawDSSE = await readFile(opts.dsse);
const native = JSON.parse(rawNative.toString('utf8'));
const envelope = JSON.parse(rawDSSE.toString('utf8'));
const semantic = semanticCheck(envelope, native);

// UNSIGNED local semantic controls: these do not test Selo's signed-envelope verifier.
const negative = { subject_mismatch_rejected: false, predicate_type_mismatch_rejected: false };
if (semantic.statement && Array.isArray(semantic.statement.subject) &&
    semantic.statement.subject.length > 0) {
  const change = (field, value) => {
    const statement = structuredClone(semantic.statement);
    if (field === 'subject') statement.subject[0].digest.sha256 = value;
    else statement.predicateType = value;
    return { ...envelope, payload: Buffer.from(JSON.stringify(statement)).toString('base64') };
  };
  const invalidDigest = native.diff_hash === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  negative.subject_mismatch_rejected =
    !semanticCheck(change('subject', invalidDigest), native).pass;
  negative.predicate_type_mismatch_rejected =
    !semanticCheck(change('predicateType', 'invalid'), native).pass;
}

const report = {
  schema: 'selo-store-interop-v1',
  source: 'Receipt Protocol reference/store-poc/store.mjs (actual API, not stub)',
  semantic: { pass: semantic.pass, reasons: semantic.reasons },
  negative, cases: [],
  limitations: [
    'Signer pin must be independently obtained; embedded receipt key is not a trust anchor',
    'Negative semantic controls are UNSIGNED; not a Selo re-signed attack test',
    'A mock verifier only tests harness control flow, not real Selo cryptography',
    'Selo verifies signatures; Store only preserves opaque bytes'
  ]
};
for (const [kind, bytes, inputPath, format] of [
  ['native', rawNative, opts.native, 'receipt'],
  ['dsse', rawDSSE, opts.dsse, 'in-toto/DSSE']
]) {
  const original = verify(inputPath, format);
  const stored = storeReceipt(bytes);
  const retrieved = getReceiptRaw(stored.digest);
  const identical = Buffer.isBuffer(retrieved) && retrieved.equals(bytes);
  const digestOK = stored.digest === sha(bytes) && retrieved &&
    sha(retrieved) === stored.digest;
  const outputPath = join(out, kind + '-retrieved.json');
  if (retrieved) await writeFile(outputPath, retrieved);
  const replay = retrieved ? verify(outputPath, format) : null;
  // Compare ALL structured fields; a matching process exit code is insufficient.
  const verdictSame = Boolean(replay && isDeepStrictEqual(original.result, replay.result));
  const pass = Boolean(identical && digestOK && original.pass && replay?.pass && verdictSame);
  report.cases.push({ kind, original_sha256: sha(bytes), store_digest: stored.digest,
    stored_deduped: stored.deduped, output_path: outputPath,
    byte_identical: identical, digest_bound: Boolean(digestOK),
    original, replay, structured_verdict_equal: verdictSame, pass });
}
report.pass = report.cases.every(c => c.pass) && semantic.pass &&
  Object.values(negative).every(Boolean);
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
