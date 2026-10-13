// S3 Bundle Round Trip: store supported bundle, retrieve, reconstruct dir
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// VATE repo is a sibling checkout; override with --bundle <path> if needed
const VATE_ROOT = process.env.VATE_ROOT
  ? resolve(process.env.VATE_ROOT)
  : resolve(__dirname, '../../../vate-test');
const BUNDLE = join(VATE_ROOT, 'reference/s3-observation-example/inputs/seaweedfs-4.48/instance/bundles/supported');
const OUT = join(__dirname, 'tmp-s3-roundtrip/supported');

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// Byte-level content-addressed store (format-agnostic, no JSON.parse)
const byteStore = new Map();

function storeBytes(buf) {
  const d = sha256Hex(buf);
  if (byteStore.has(d)) return { digest: d, deduped: true };
  byteStore.set(d, Buffer.from(buf)); // defensive copy
  return { digest: d, deduped: false };
}

function getBytes(digest) {
  const e = byteStore.get(digest);
  if (!e) return null;
  return Buffer.from(e); // defensive copy
}

// Step 1: Store all files from bundle
const files = readdirSync(BUNDLE).filter(f => f !== 'manifest.json');
const manifest = JSON.parse(readFileSync(join(BUNDLE, 'manifest.json'), 'utf8'));

console.log('=== Step 1: Store ===');
const stored = {};
let fails = 0;
for (const f of files) {
  const buf = readFileSync(join(BUNDLE, f));
  const r = storeBytes(buf);
  stored[f] = r.digest;
  // Verify against manifest
  const expected = manifest.artifacts[f].digest.value;
  const match = r.digest === expected;
  console.log(`  ${f}: stored digest=${r.digest.slice(0,12)}... manifest_match=${match}`);
  if (!match) { console.error(`MISMATCH for ${f}`); fails++; }
}
// Also store manifest itself
storeBytes(readFileSync(join(BUNDLE, 'manifest.json')));

// Step 2: Retrieve and reconstruct
console.log('\n=== Step 2: Retrieve ===');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const f of [...files, 'manifest.json']) {
  const buf = getBytes(stored[f] || sha256Hex(readFileSync(join(BUNDLE, 'manifest.json'))));
  if (!buf) { console.error(`MISSING: ${f}`); fails++; continue; }
  writeFileSync(join(OUT, f), buf);
  // Verify byte-for-byte
  const orig = readFileSync(join(BUNDLE, f));
  const same = buf.equals(orig);
  console.log(`  ${f}: retrieved, byte_identical=${same}`);
  if (!same) { console.error(`BYTE MISMATCH for ${f}`); fails++; }
}

console.log('\n=== Round trip complete ===');
console.log(`Retrieved ${files.length + 1} files to ${OUT}`);
if (fails > 0) { console.error(`FAILURES: ${fails}`); process.exit(1); }
console.log('ALL CHECKS PASSED');
