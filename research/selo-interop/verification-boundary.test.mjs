// Contract regression tests. Mock verifier only; NOT official Selo interop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const harness = resolve('research/selo-interop/selo-roundtrip.mjs');
const goodHash = 'a'.repeat(64);
const native = { receipt_id:'case-1', receipt_hash:goodHash, task_id:'case-1' };
const statement = { _type:'https://in-toto.io/Statement/v1', predicateType:'https://selo.c1.run/attestation/v1',
  subject:[{name:'selo://case-1',digest:{sha256:goodHash}}], predicate:native };
const goodVerdict = format => ({valid:true,hash_ok:true,signature_ok:true,pubkey_pinned:true,
  pubkey_match:true,provenance:'PINNED',format,errors:[]});
const cases = [
  ['baseline', x=>x, true],
  ['invalid signature', x=>({...x,signature_ok:false}), false],
  ['unpinned signer', x=>({...x,pubkey_pinned:false}), false],
  ['wrong key', x=>({...x,pubkey_match:false}), false],
  ['untrusted provenance', x=>({...x,provenance:'EMBEDDED'}), false],
  ['missing errors array', x=>{delete x.errors;return x}, false],
  ['reported invalid', x=>({...x,valid:false}), false],
  ['hash mismatch', x=>({...x,hash_ok:false}), false]
];
for (const [name, mutate, expected] of cases) test(name, () => {
  const dir = mkdtempSync(join(tmpdir(),'rp-selo-contract-'));
  try {
    const nativeFile=join(dir,'native.json'), dsseFile=join(dir,'dsse.json');
    const key=join(dir,'trusted.pub'), mock=join(dir,'mock.cjs');
    writeFileSync(nativeFile,JSON.stringify(native));
    writeFileSync(dsseFile,JSON.stringify({payloadType:'application/vnd.in-toto+json',
      payload:Buffer.from(JSON.stringify(statement)).toString('base64'),signatures:[{sig:'synthetic'}]}));
    writeFileSync(key,'out-of-band fixture only');
    const mockCode = `#!/usr/bin/env node
const fs=require('node:fs');
const p=process.argv[3]; const format=p.includes('dsse')?'in-toto/DSSE':'receipt';
let x=${JSON.stringify(mutate(goodVerdict('receipt')))};
x.format=format; console.log(JSON.stringify(x));`;
    // Spawn a node executable mock; it must never be treated as a cryptographic verifier.
    writeFileSync(mock, mockCode,{mode:0o755});
    const run=spawnSync(process.execPath,[harness,'--native',nativeFile,'--dsse',dsseFile,
      '--selo',mock,'--pubkey',key,'--out',join(dir,'out')],{encoding:'utf8'});
    const report=JSON.parse(readFileSync(join(dir,'out','report.json'),'utf8'));
    assert.equal(report.pass,expected,run.stderr);
    assert.equal(run.status,expected?0:1,run.stderr);
    assert.equal(report.cases.length,2);
    if(expected) assert(report.cases.every(c=>c.byte_identical&&c.digest_bound&&c.structured_verdict_equal));
  } finally { rmSync(dir,{recursive:true,force:true}); }
}));
