# Receipt Store POC — External Review Candidate

A **schema-agnostic JSON** receipt storage and reference-resolution experiment. This is an in-memory research POC, not a hosted service or a VATE implementation.

## Boundaries

- Stores the original input bytes without rewriting them; SHA-256 of those bytes is the **storage digest**.
- Parses JSON to index `transaction_id` and `receipt_id` (VATE-oriented field extraction is currently heuristic).
- Retrieves byte-identical data, queries transactions, and resolves outgoing `admission.receipt_id` references.
- Never signs receipts, verifies signatures, asserts execution success, or makes issuer/trust decisions.
- **Source-protocol digest != storage digest by default.** The resolver checks digest equality only if the reference explicitly declares `{alg:"sha256",profile:"raw-bytes",value:"..."}`. Unspecified canonicalization/digest scope yields `binding_status:"not_assessed"`, `digest_match:null`. This is intentionally conservative, **not** a claim of VATE-native digest verification.
- Multiple stored receipts may share a `receipt_id`; reference matching considers all candidates rather than the first inserted record.

## Run

Requires Node.js 18+; no npm dependencies.

```sh
cd reference/store-poc
node negative-tests.mjs
node store.mjs /absolute/path/to/json-receipt-samples
```

The regression suite is self-contained and does not require a VATE checkout. The second command is an optional sample demonstration. To reproduce the previously reported 63 VATE sample imports, obtain the sample JSON files from [VATE](https://github.com/Poke-nushi/Verifiable-Agent-Trust-Envelope), pin its Git commit, and pass the directory path. **The earlier 63/63 result is from Nova's report, not independently re-run by this review.** The sample provenance and exact commit are not yet frozen here.

## Regression cases

Byte-preserving round trip; SHA-256 addressing; transaction lookup; deduplication; duplicate receipt IDs with distinct digests; explicit raw-byte digest mismatch; unsupported digest profile; missing reference; missing receipt.

## Known limitations / out of scope

- No persistence, authentication, HTTP API, rate limits, or multi-tenant isolation.
- JSON only; arbitrary binary formats are not parsed/indexed.
- VATE-native digest binding, canonicalization, and signature semantics **not verified**. The `digestObject` helper uses a non-RFC-8785 serializer and must not be treated as JCS.
- No cross-format relationship normalization, reverse relation indexes, or exhaustive receipt-linkage semantics.
- All receipt claims and relationships are untrusted input; a matching digest proves content correspondence under the declared profile, not truth, authorization, or execution.
- The repository's test suite must be executed by the reviewer/CI; this change was prepared through GitHub file edits, without an independent local Node execution in this session.

## External review questions

1. Does this separation between opaque storage digest and source-protocol digest preserve VATE's trust boundary?
2. Which exact VATE digest scopes/canonicalization profiles would an optional adapter need to support?
3. Are there ambiguity cases beyond duplicate `receipt_id` values that should be modeled without inferring trust?
