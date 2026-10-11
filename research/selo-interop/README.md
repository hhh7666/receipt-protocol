# Selo interop experiment — executable harness

Source inspection pinned to Selo default branch snapshot `edec07dde2b0e19de7193568db4506dbf11bd475` (2026-10-11).

**Status: harness committed, real Selo execution NOT YET RUN.** This environment has no reachable GitHub network from the local execution container and no installed Selo binary or authentic Selo receipt fixture. Do not treat the harness as a passing integration test until an execution log is attached.

## Reproduce with a real Selo checkout and binary

```sh
git clone https://github.com/C1-run/Selo.git
cd Selo
git checkout edec07dde2b0e19de7193568db4506dbf11bd475
go build -o ./selo ./cmd/selo/
./selo keys generate
# Run a contained task to create a native signed receipt, then locate the emitted receipt.json.
./selo run "NOOP"
./selo verify /ABS/PATH/TO/receipt.json --pubkey YOUR_PINNED_FINGERPRINT
./selo receipt export /ABS/PATH/TO/receipt.json --format in-toto --out /ABS/PATH/TO/export.dsse.json
node /ABS/PATH/TO/receipt-protocol/research/selo-interop/selo-roundtrip.mjs \
  --native /ABS/PATH/TO/receipt.json \
  --dsse /ABS/PATH/TO/export.dsse.json \
  --selo /ABS/PATH/TO/Selo/selo \
  --pubkey YOUR_PINNED_FINGERPRINT \
  --out /tmp/selo-interop
```

Use the actual output path of `selo run`; do not assume it is fixed. Pin the signer fingerprint **out of band**; the receipt's embedded public key is not a trusted identity. Run this in an isolated test repository because Selo executes a coding task.

The harness runs `selo verify` before and after storing each native and DSSE JSON file. It requires both verification commands to succeed, exact byte equality, and equal exit codes; outputs SHA-256, per-case evidence, and `report.json`. A failing verifier produces a failing test, not a false success.

## Source-derived semantic notes

- `internal/receipt/sign.go`: native receipt signature uses `CanonicalJSON`, which clears signature/public key/receipt hash/anchor/timestamp/transparency fields before Go `json.Marshal`. It is **not** safe to replace this with an arbitrary JSON canonicalizer.
- `internal/receipt/dsse.go`: DSSE PAE signs exact in-toto Statement bytes; `predicate` embeds a marshalled native receipt. Subject SHA-256 is the audited `diff_hash` or falls back to `receipt_hash`. Subject digest is not necessarily a digest of the whole receipt or envelope.
- `cmd/selo/cmd_receipt.go`: `receipt export --format in-toto` re-signs with a resolved signer and leaves native receipt unchanged.
- Our raw-byte storage digest is **not** Selo's `receipt_hash`, `diff_hash`, or DSSE payload digest. Never equate them.

## Next adversarial gate

Generate tampered copies (native payload byte edit; DSSE payload byte edit; re-sign with unpinned attacker key). Require the source verifier to reject tampering and to reject the unpinned signer under `--pubkey`. Record exact source commit, binary version, fixture digests, commands, stdout/stderr, and exit codes. A separate DSSE signature verifier is a later task; the present harness delegates to Selo.

## Decision

Do **not** declare DSSE a mutually adopted shared envelope until Selo's maintainer confirms schema and policy expectations and authentic fixtures pass both paths.
