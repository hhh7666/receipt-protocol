# Receipt Store POC

A minimal, format-agnostic receipt storage and resolution layer.

## What it does

- Stores receipts as **opaque bytes**, indexed by SHA-256 content digest
- Retrieves by digest (byte-for-byte identical)
- Queries by transaction ID
- Resolves links between receipts, checking digest bindings

## What it explicitly does NOT do

- Does not sign receipts
- Does not modify receipt content
- Does not verify signatures
- Does not decide trust — returns `reference_found` / `digest_match` / `trust_assessed` as separate dimensions

## Quick start

```bash
node store.mjs /path/to/receipts/
node negative-tests.mjs
```

## Tested against

- 63 VATE sample receipts from Poke-nushi/Verifiable-Agent-Trust-Envelope
- 7 negative assertions across 4 test suites

## Status

| Capability | Verified |
|---|---|
| Store opaque bytes, index by sha256 | Yes |
| Byte-for-byte retrieval | Yes |
| Query by transaction_id | Yes |
| Resolve outgoing references | Yes |
| Detect digest mismatch (tampered reference) | Yes |
| Handle missing references | Yes |
| Deduplicate identical content | Yes |
| HTTP server / REST API | No — in-memory only |
| Verify signatures | No — out of scope |
| Cross-format relation semantics | No — not yet tested |
| RFC 8785 JCS canonicalization | No — loose POC-grade stringify |

## Known limitations

- In-memory only, no persistence
- `stableStringify` is not RFC 8785 JCS (number edge cases, undefined handling)
- Digest format: raw hex string (not `{alg, value}` object — VATE's format)
- No HTTP layer yet
