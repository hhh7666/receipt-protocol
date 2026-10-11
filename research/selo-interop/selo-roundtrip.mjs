#!/usr/bin/env node
// Selo -> byte-preserving store -> retrieval -> Selo verifier.
// Usage: node selo-roundtrip.mjs --native /path/receipt.json --dsse /path/export.json --selo /path/selo
// Optional: --pubkey <fingerprint-or-public-key-file> --out /tmp/selo-interop
// Requires Node 18+. Never executes receipt content.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw Error('Expected --key value pairs');
  opts[argv[i].slice(2)] = argv[i + 1];
}
for (const key of ['native', 'dsse', 'selo']) if (!opts[key]) throw Error('Missing --' + key);
const out = resolve(opts.out || './selo-interop-output');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = path => {
  const args = ['verify', path];
  if (opts.pubkey) args.push('--pubkey', opts.pubkey);
  const r = spawnSync(opts.selo, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error?.message || null };
};
const report = { schema: 'selo-interop-v0', cases: [], limitations: ['Selo verifier is authoritative for native/domain semantics', 'Unsigned receipt claims are not independently verified by this harness', 'This test does not establish common-envelope agreement'] };
await mkdir(out, { recursive: true });
for (const [kind, path] of [['native', opts.native], ['dsse', opts.dsse]]) {
  const input = await readFile(path);
  const parsed = JSON.parse(input.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(kind + ': expected JSON object');
  if (kind === 'dsse' && (typeof parsed.payloadType !== 'string' || typeof parsed.payload !== 'string' || !Array.isArray(parsed.signatures))) throw Error('Malformed DSSE envelope');
  const original = verify(path);
  const stored = join(out, digest(input) + '-' + kind + '.json');
  await writeFile(stored, input, { flag: 'wx' }).catch(async e => {
    if (e.code !== 'EEXIST') throw e;
    const existing = await readFile(stored);
    if (!existing.equals(input)) throw Error('Digest collision / existing file mismatch');
  });
  const retrieved = await readFile(stored);
  const replay = verify(stored);
  const byteIdentical = input.equals(retrieved);
  const sameVerdict = original.exit === replay.exit;
  const accepted = original.exit === 0 && replay.exit === 0;
  report.cases.push({ kind, input_sha256: digest(input), stored_path: stored, byte_identical: byteIdentical, original, replay, same_verdict: sameVerdict, accepted, pass: byteIdentical && sameVerdict && accepted });
}
report.pass = report.cases.every(c => c.pass);
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
