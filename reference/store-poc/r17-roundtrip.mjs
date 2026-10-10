// R17 Round Trip: store -> retrieve byte-for-byte -> run VATE's own checker
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vateRoot = join(__dirname, '..', '..', '..', 'vate-test');
const r17Dir = join(vateRoot, 'reference', 'receipt-linkage-example', 'inputs', 'R17');

console.log('=== R17 Round Trip Test ===\n');

// Step 1: Read originals as raw bytes
const admissionRaw = readFileSync(join(r17Dir, 'admission.json'));
const postRaw = readFileSync(join(r17Dir, 'post.json'));
console.log(`1. Read originals:`);
console.log(`   admission.json: ${admissionRaw.length} bytes, sha256=${createHash('sha256').update(admissionRaw).digest('hex').slice(0,16)}...`);
console.log(`   post.json:     ${postRaw.length} bytes, sha256=${createHash('sha256').update(postRaw).digest('hex').slice(0,16)}...`);

// Step 2: Store in our receipt store (by content digest)
const store = new Map();
function storeBytes(raw) {
  const digest = createHash('sha256').update(raw).digest('hex');
  store.set(digest, raw);
  return digest;
}
const admissionDigest = storeBytes(admissionRaw);
const postDigest = storeBytes(postRaw);
console.log(`\n2. Stored in receipt store:`);
console.log(`   admission digest: ${admissionDigest.slice(0,16)}...`);
console.log(`   post digest:      ${postDigest.slice(0,16)}...`);

// Step 3: Retrieve byte-for-byte
const retrievedAdmission = store.get(admissionDigest);
const retrievedPost = store.get(postDigest);
const adMatch = Buffer.compare(admissionRaw, retrievedAdmission) === 0;
const postMatch = Buffer.compare(postRaw, retrievedPost) === 0;
console.log(`\n3. Retrieved byte-for-byte:`);
console.log(`   admission identical: ${adMatch}`);
console.log(`   post identical:     ${postMatch}`);

// Step 4: Write retrieved files to temp dir, run VATE's own checker
const tmpDir = join(__dirname, 'tmp-r17');
mkdirSync(tmpDir, { recursive: true });
writeFileSync(join(tmpDir, 'admission.json'), retrievedAdmission);
writeFileSync(join(tmpDir, 'post.json'), retrievedPost);
console.log(`\n4. Wrote retrieved files to ${tmpDir}`);

console.log(`\n5. Running VATE's recipient_example.py on retrieved files...`);
try {
  const venvPython = join(vateRoot, '.venv', 'bin', 'python');
  const result = execSync(
    `${venvPython} -B reference/receipt-linkage-example/recipient_example.py ` +
    `--admission ${join(tmpDir, 'admission.json')} ` +
    `--post ${join(tmpDir, 'post.json')}`,
    { cwd: vateRoot, encoding: 'utf8', timeout: 30000 }
  );
  console.log(result);
} catch (e) {
  console.log('Exit code:', e.status);
  console.log(e.stdout);
  if (e.stderr) console.log('stderr:', e.stderr.slice(0,500));
}
