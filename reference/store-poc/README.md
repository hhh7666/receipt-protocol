# Receipt Store POC

A minimal, format-agnostic receipt storage and resolution layer.

## What it does

- `POST /receipts` — store an arbitrary receipt (any format)
- `GET /receipts/{digest}` — retrieve by content digest
- `GET /receipts?transaction_id=...` — query by transaction
- `GET /receipts/{digest}/relations` — resolve links between receipts

## What it does NOT do

- Does not sign receipts
- Does not modify receipt content
- Does not decide trust (returns records, caller applies policy)
- Does not verify signatures (that stays with the issuer/consumer)

## Tested against

- 63 VATE sample receipts (Poke-nushi/Verifiable-Agent-Trust-Envelope)
- 4 negative test suites: byte preservation, digest mismatch, missing reference, duplicate ingestion

## Status

| Capability | Verified |
|---|---|
| Store arbitrary receipts | Yes |
| Retrieve by digest | Yes |
| Query by transaction_id | Yes |
| Resolve relations between receipts | Yes |
| Digest binding check (reference matches stored) | Yes |
| Detect digest mismatch | Yes |
| Handle missing references | Yes |
| Deduplicate on ingestion | Yes |
| Verify signatures | No — out of scope |
| Make trust decisions | No — out of scope |
| Cross-format relation semantics | Not yet tested |
