# Receipt Protocol

**Minimal self-attested activity receipts for AI agents.**

> We don't do identity. We do receipts.
>
> Block Buzz, Sigil, MCP-I, TRAIL, OpenA2A, AgentStamp — they answer "who are you?".
> We answer "what did you say you did?".

---

## Why this exists

AI agents are starting to do real things — buy API credits, call tools, move money, submit work. But when an agent says "I completed the task" or "I made the payment", how do you know it's not hallucinating?

You don't. Not from the agent itself.

Receipt Protocol gives agents a way to **sign and record their claims**, so those claims can be carried to another platform and verified — without trusting the agent, without trusting a central authority, and without blockchain.

**What it proves**: "This agent claimed it did X, at this time, and this record hasn't been tampered with."

**What it doesn't prove**: That X actually happened. (For that, you need peer attestation or external verification.)

---

## Quick Start

No accounts, no API keys, no blockchain. Just HTTP.

```bash
# Issue a receipt
curl -X POST https://receipt.lifari777.workers.dev/issue \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my-agent@mydomain.com",
    "action": "called payment-api",
    "platform": "stripe.com",
    "proof": "txn_abc123"
  }'

# Verify it
curl https://receipt.lifari777.workers.dev/verify/<receipt-id>

# Beautiful shareable card
open https://receipt.lifari777.workers.dev/card/<receipt-id>
```

---

## Endpoints

| Endpoint | Method | What it does |
|---|---|---|
| `/issue` | POST | Record a self-attested claim, sign it with Ed25519 |
| `/verify/:id` | GET | Verify the claim was signed and not tampered |
| `/card/:id` | GET | Beautiful shareable proof card |
| `/agent/:id` | GET | List all receipts for an agent |
| `/pubkey` | GET | Get the server's public key |

---

## Verdict Schema (v2.4)

The `/verify/:id` response returns a multi-axis verdict, not a single string:

| Axis | What it means | Can it change? |
|---|---|---|
| `signature_valid_at_signing_time` | Was the signature valid when issued? | No — immutable |
| `bytes_present_now` | Are the bytes on this route right now? | Yes — can be deleted |
| `key_currently_standing` | Does the issuer still control this identity? | Yes — keys can rotate/revoke |
| `verifier_observation_at` | What did the verifier see at checked_at? | Per-verifier, per-call |

Verdict values:
- `VERIFIED` — bytes present, signature valid
- `NOT_FOUND` — never existed
- `WAS_VERIFIED_NOW_ABSENT` — was verified, bytes later deleted
- `TAMPERED` — signature mismatch

---

## Attestation Topology

| Level | Who attests | What it proves | Status |
|---|---|---|---|
| Self | The agent itself | "I claim I did X" | **Live** |
| Peer | Another agent | "We both agree X happened" | Roadmap |
| Third-party | An external verifier | "I saw X happen" | Roadmap |

We start at self-attested because it's the lowest friction. Every other layer builds on top of this.

---

## Design Principles

1. **No auth** — friction is the enemy of adoption. Start open.
2. **No blockchain** — blockchain solves consensus, not receipts. Ed25519 is enough.
3. **No accounts** — bring your own identity (any string works).
4. **Self-attested first** — start with the simplest thing that works, add attestation later.
5. **Portable** — receipts travel with the agent, not the platform.

---

## Why not just use logs?

Logs are self-reported. Nothing stops the agent — or a compromised proxy — from rewriting history after the fact.

A receipt is different: it's cryptographically signed, tamper-evident, and portable. Any third party can verify it without trusting the issuer.

---

## Use Cases

- **Agent marketplaces** — prove an agent completed a task
- **Escrow platforms** — audit trail for payment releases
- **Reputation systems** — collect verifiable activity history
- **Cross-platform identity** — carry your track record with you
- **Compliance/audit** — timestamped, verifiable record of what was claimed

---

## Tech Stack

- **Ed25519 signatures** — self-contained, offline-verifiable
- **Cloudflare Workers** — globally distributed, low latency
- **Cloudflare KV** — fast, eventually consistent storage
- **Canonical JSON** — deterministic serialization for signing

---

## Roadmap

- [x] v0.1 — basic receipts (no signature)
- [x] v0.2 — Ed25519 signing
- [x] v1.0 — multi-axis verdict
- [x] v2.0 — beautiful shareable cards
- [ ] v3.0 — multi-sig receipts (peer attestation)
- [ ] v4.0 — receipt chaining (action A proves you can do action B)
- [ ] v5.0 — receipt graphs (full agent history)

---

## Contributing

This is a living document. Open an issue if you have questions or ideas.

---

## License

MIT
