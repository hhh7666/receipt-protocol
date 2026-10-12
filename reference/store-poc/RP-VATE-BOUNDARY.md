# RP v2.9 ↔ VATE: verification boundary and mapping (non-normative)

This note incorporates the corrections in [VATE issue #2](https://github.com/Poke-nushi/Verifiable-Agent-Trust-Envelope/issues/2#issuecomment-6117652611). It is a mapping aid, **not** a claim of VATE compatibility or verified issuer authority.

## Keep these results distinct

- **RP Store `binding_status`**: evaluates a referenced receipt ID and, when an explicit supported digest profile is present, whether a candidate's *stored raw bytes* match that SHA-256 digest. `digest_matched` means content binding only. The resolver does **not** assess admission executability, request/runtime/transaction bindings, execution windows, issuer authority, permission, or real-world execution.
- **VATE `record_linkage`**: a checker assessment over additional constraints, including admission executability, transaction/runtime/request bindings, execution window and selected reported constraints. **Never translate RP `digest_matched` to VATE `record_linkage: matched`**.
- **Effect outcome**: independent of both checks. A valid link does not prove that the operation succeeded.

## Native field mapping

| RP field | VATE concept | Rule |
|---|---|---|
| `related_receipts[].id` | `post.admission.receipt_id` | ID candidate |
| `related_receipts[].relationship` | relation kind | e.g. `admission`; **not** the referenced ID |
| `related_receipts[].content_digest` | `post.admission.digest` | **Do not copy**: RP hashes stored original file bytes; VATE hashes sorted, compact JSON representation. Compute each independently from its specified basis. |
| `outcome: claimed_success` | `post.result.outcome` | Reported effect, requires explicit enum/value mapping; **not** `core_result.outcome` |
| `agent` | identity in request/subject/execution context | Ambiguous without identity semantics; do not map blindly |
| `action` | `request.action` | Requires semantic and value check, not name matching |

The example pinned at commit `96498a3` contains **admission schema v2.8** and **post schema v2.9**; do not label the pair uniformly v2.9.

## Unresolved attempt / reconciliation

When the provider's terminal effect is unknown (including `RECONCILE_REQUIRED`), retain the immutable admission and locally known attempt/request identifier. Append later observations with their own source/time and link to the original attempt; do not mutate the admission. VATE's current post-execution receipt schema has no `unknown` outcome: **withhold terminal post-execution receipt** rather than inventing a success/failure value. A 2xx response or provider task ID alone does not prove delivery.

## Required negative checks before claiming interoperability

1. Same ID but modified original bytes → RP digest mismatch.
2. Same JSON object but changed whitespace → RP raw-byte digest changes; VATE sorted-compact digest may stay constant.
3. RP digest match with incorrect transaction/runtime/request or execution window → must **not** be reported as VATE linkage matched.
4. Missing/untrusted signer or authority → remains unassessed, not trusted.
5. Valid record linkage with failed effect → effect remains failed.
6. Unresolved effect with later reconciliation → no invented terminal VATE post receipt.

These are **test requirements**, not assertions that official VATE/Selo integration tests have passed.
