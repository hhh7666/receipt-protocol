// R17 Round Trip: store -> retrieve byte-for-byte -> run VATE's own checker
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeReceipt, getReceiptRaw } from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vateRoot = join(__dirname, '..', '..', '..', 'vate-test');
const r17Dir = join(vateRoot, 'reference', 'receipt-linkage-example', 'inputs', 'R17');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  PASS: ${name}`);
  else { console.log(`  FAIL: ${name}`); failures++; }
}

console.log('=== R17 Round Trip ===\n');

// Step 1: Read originals as raw bytes
const admissionRaw = readFileSync(join(r17Dir, 'admission.json'));
const postRaw = readFileSync(join(r17Dir, 'post.json'));
console.log(`1. Read originals:`);
console.log(`   admission: ${admissionRaw.length} bytes`);
console.log(`   post:      ${postRaw.length} bytes`);

// Step 2: Store through the real storeReceipt()
const adResult = storeReceipt(admissionRaw);
const postResult = storeReceipt(postRaw);
console.log(`\n2. Stored via storeReceipt():`);
console.log(`   admission digest: ${adResult.digest.slice(0,16)}... deduped=${adResult.deduped}`);
console.log(`   post digest:      ${postResult.digest.slice(0,16)}... deduped=${postResult.deduped}`);

// Step 3: Retrieve via getReceiptRaw() — goes through the store's own storage
const retrievedAd = getReceiptRaw(adResult.digest);
const retrievedPost = getReceiptRaw(postResult.digest);
check('getReceiptRaw returns non-null for admission', retrievedAd !== null);
check('getReceiptRaw returns non-null for post', retrievedPost !== null);
check('admission bytes identical after store->retrieve',
      Buffer.compare(admissionRaw, retrievedAd) === 0);
check('post bytes identical after store->retrieve',
      Buffer.compare(postRaw, retrievedPost) === 0);

// Step 4: Write retrieved bytes to temp files, run VATE's checker
const tmpDir = join(__dirname, 'tmp-r17');
mkdirSync(tmpDir, { recursive: true });
writeFileSync(join(tmpDir, 'admission.json'), retrievedAd);
writeFileSync(join(tmpDir, 'post.json'), retrievedPost);
console.log(`\n4. Wrote retrieved bytes to tmp-r17/`);

// Step 5: Run VATE's recipient_example.py on the retrieved files
console.log(`5. Running VATE recipient_example.py on retrieved files...`);
let vateOutput, vateExitCode = 0;
try {
  const venvPython = join(vateRoot, '.venv', 'bin', 'python');
  vateOutput = execSync(
    `${venvPython} -B reference/receipt-linkage-example/recipient_example.py ` +
    `--admission ${join(tmpDir, 'admission.json')} ` +
    `--post ${join(tmpDir, 'post.json')}`,
    { cwd: vateRoot, encoding: 'utf8', timeout: 30000 }
  );
} catch (e) {
  vateExitCode = e.status;
  vateOutput = e.stdout || '';
}

// Parse the JSON output and assert
let vateResult;
try { vateResult = JSON.parse(vateOutput); } catch { vateResult = null; }

check('VATE checker produced parseable JSON', vateResult !== null);
if (vateResult) {
  check('record_linkage = matched', vateResult.record_linkage === 'matched');
  check('core_result.outcome = success', vateResult.core_result?.outcome === 'success');
  console.log(`\n   VATE result: ${vateResult.record_linkage} (exit code ${vateExitCode})`);
  console.log(`   reason codes: ${vateResult.core_result?.reason_codes?.join(', ')}`);
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'} ===`);
if (failures > 0) process.exit(1);
