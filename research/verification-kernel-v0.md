# Verification Kernel v0 — frozen interface and adversarial contract

Status: **research proposal / not an implemented verifier**. This document does not claim compatibility with Selo, VATE, DSSE, or RFC 3161.

## Goal

Turn a self-attested receipt from an opaque signed claim into an inspectable set of **independent evidence checks**. Preserve issuer semantics: a cryptographically valid signature must never be reported as proof of execution, authorization, policy compliance, or accurate claimed time.

## Evidence boundaries

| Check | Required input | Allowed conclusion | Must not conclude |
|---|---|---|---|
| Raw-byte integrity | Original bytes, declared SHA-256 digest with explicit raw-byte profile | Retrieved bytes match committed bytes | Claim is true |
| Ed25519 signature | Explicit signed-byte profile, signature, public key | Signature matches supplied key and signed bytes | Signer is trusted |
| Signer policy | Out-of-band trusted key or pinned fingerprint | Signer matches recipient policy | Signer observed the action |
| Time | Trusted timestamp token bound to an explicit digest; trusted TSA roots and verification | Authority attested digest existed no later than timestamp (subject to TSA assumptions) | Action occurred at that time |
| Log inclusion | Inclusion proof, trusted signed checkpoint, exact leaf hashing profile | Leaf included in a particular checkpoint | Log is globally consistent |
| Log consistency | Consistency proof between pinned checkpoints | One checkpoint extends another | No split-view absent witnesses/gossip |
| Domain outcome | Source-specific evidence and verifier | Only source-verifier-specific verdict | Generic store attests execution |

## Verification output contract

Return structured results **per check** with states `PASS | FAIL | NOT_ASSESSED | UNSUPPORTED`, reason codes, evidence identifiers, verifier version, and explicit trust policy identifier. Never emit a single unqualified `verified: true`. An unpinned key can pass signature math while signer policy remains NOT_ASSESSED.

## Canonicalization and envelopes

1. Preserve native receipt bytes and any DSSE envelope bytes independently. Do not normalize JSON before storage or assume SHA-256 of raw JSON equals a source-protocol digest.
2. DSSE signatures cover PAE over `payloadType` and exact payload bytes, not arbitrary reconstructed JSON.
3. Keep the original Selo or VATE verifier authoritative for domain-specific semantics; a Receipt Protocol adapter must not claim to reproduce those semantics.
4. Do not invent a proprietary common signed envelope until a real interop fixture demonstrates a missing property in DSSE/in-toto.
5. Specify and version any signed-byte profile; refuse unknown profiles instead of guessing.

## Mandatory negative fixtures (test plan, NOT yet executed)

- Change one byte after storing; raw-byte digest check FAIL.
- Replace signer public key while keeping signature; signature FAIL.
- Re-sign tampered content with attacker key; signature PASS but pinned signer policy FAIL.
- Valid signature with claimed timestamp in distant past and no trusted TSA; time NOT_ASSESSED.
- Valid TSA token for different digest; time FAIL.
- Valid log inclusion proof against untrusted checkpoint; inclusion NOT_ASSESSED.
- Two divergent signed log checkpoints with no witness/gossip; global consistency NOT_ASSESSED.
- Duplicate receipt IDs with distinct raw digests; do not silently select one.
- DSSE payload re-encoded as semantically equivalent JSON; preserve original bytes and ensure signature verification does not silently normalize.
- Valid Selo enforcement receipt stored/retrieved intact; generic verifier must not assert that coding checks ran unless Selo's own verifier confirms it.

## Acceptance gates

**G0**: Review threat model and obtain pinned real-world Selo native + DSSE fixtures and original verifier commands.

**G1**: Build executable independent kernel with negative fixtures; attach test logs and exact SHA/commands.

**G2**: Run Selo native → store → retrieval → native verifier and DSSE → store → retrieval → DSSE verifier. Require byte-for-byte preservation and identical verdicts.

**G3**: Add optional RFC3161 and transparency-log adapters with independent trust anchors, failure tests, and explicit limitations.

**Open design question for Selo**: Does Selo's existing DSSE/in-toto export provide a sufficient shared transport envelope, while keeping its native enforcement receipt and our self-attested receipt distinct? Compare schemas and fixtures before defining another envelope.
