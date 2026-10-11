// Demo: Receipt Protocol native admission→post-execution pair
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeReceipt, getReceiptRaw, getRelations } from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exDir = join(__dirname, 'examples', 'rp-pair');

const admRaw = readFileSync(join(exDir, 'admission.json'));
const postRaw = readFileSync(join(exDir, 'post.json'));

const adm = storeReceipt(admRaw);
const post = storeReceipt(postRaw);

console.log('Stored:');
console.log('  admission:', adm.digest.slice(0, 16), 'deduped=' + adm.deduped);
console.log('  post:     ', post.digest.slice(0, 16), 'deduped=' + post.deduped);

// Resolve: what does the post receipt reference?
const rel = getRelations(post.digest);
console.log('\nRelations from post receipt:');
console.log(JSON.stringify(rel.relations, null, 2));

// Byte-for-byte check
const r1 = getReceiptRaw(adm.digest);
const r2 = getReceiptRaw(post.digest);
console.log('\nByte-for-byte:');
console.log('  admission identical:', r1.equals(admRaw));
console.log('  post identical:    ', r2.equals(postRaw));
