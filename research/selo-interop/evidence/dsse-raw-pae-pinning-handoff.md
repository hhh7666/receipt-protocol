# Selo DSSE raw-byte PAE and signer-pinning test handoff

Status: LOCAL_EXECUTED; GITHUB_COMMIT_ATTEMPT. This note is evidence of a local test run, **not** evidence of successful real Selo CLI interoperability.

Source bundle: `selo-turn4-execution.zip` (2026-10-11), containing `research/selo-interop/dsse-raw-pae-pinning.mjs`, `research/selo-interop/evidence/dsse-raw-pae-pinning-report.json`, and `EXECUTION-2026-10-11-19.md`.

Reported local execution (Node.js): `node --check research/selo-interop/dsse-raw-pae-pinning.mjs` exit 0; `node research/selo-interop/dsse-raw-pae-pinning.mjs` 10/10 PASS. Two positive controls cover compact and pretty JSON signed over exact payload bytes; negative controls cover signed subject mismatch, signed predicate type mismatch, unsigned payload tampering, signature bitflip, valid attacker-key signature, keyid mismatch, noncanonical Base64, and missing signature. Tests used in-process `storeReceipt`/`getReceiptRaw` and a locally generated, independently pinned Ed25519 key.

Script SHA-256 from local execution record: `dbb6f4f59600cf34ecaaa2ff773a6b25d5b7c831bc11611c5ebc6812f9625b06`.

**Not executed:** genuine Selo CLI, Selo-generated DSSE fixture, native-to-Store-to-Selo-verifier end-to-end test, and production signer authorization. Signature validity and semantic binding are separate verification gates.

Next: commit the executable script and machine-readable report; obtain real Selo binary and same-signer native/DSSE fixtures; execute positive and signed semantic-negative CLI tests; capture commands, exit codes, output JSON, and SHA-256. Do not label this externally validated.
