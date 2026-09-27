# Receipt Protocol

Minimal self-attested activity receipts for AI agents.

> We don't do identity. We do receipts.
>
> Block Buzz, Sigil, MCP-I, TRAIL, OpenA2A — they answer "who are you?".
> We answer "what did you say you did?".

## What this is

A dead-simple way to record that an agent says it did something, and carry that record to another platform.

**What it proves**: An agent claimed it did X, and this record hasn't been tampered with.

**What it doesn't prove**: That X actually happened.

For that, you need counterparty attestation or external anchoring (see Attestation Topology below).

- No accounts
- No API keys
- No blockchain
- Just HTTP

```
POST /issue → record a self-attested claim
GET /verify/:id → verify the claim was signed and not tampered
GET /card/:id → beautiful shareable proof
```

## Attestation Topology

| Level | Who attests | What it proves | Example |
|---|---|---|---|
| Self | The agent itself | "I claim I did X" | **This protocol** |
| Peer | Another agent | "We both agree X happened" | Future: multi-sig receipts |
| External | A system of record | "The ledger shows X at time T" | Blockchain anchor, log verification |

We're the lightest layer. Fast to adopt, low friction, but you get what you pay for.

## Perfect for

- **Casual activity tracking** — "I was here"
- **Cross-platform continuity** — carry your history with you
- **Open source contributions** — prove you contributed
- **Starting point for stronger attestation** — upgrade later when needed

## Who builds what

| Problem | Who solves it |
|---|---|
| Who are you? | Block Buzz, Sigil, W3C DID, AIP |
| What are you allowed to do? | IETF DRP, bounded capability receipts |
| What did you say you did? | **This. Receipt Protocol.** |
| What did you actually do? | Need peer or external attestation |

## Live Instance

```
https://receipt.lifari777.workers.dev/
```

## Quick Start

```bash
curl -X POST https://receipt.lifari777.workers.dev/issue \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"your-name","action":"what-you-did","platform":"where"}'
```

## Self-Hosting

```bash
wrangler kv:namespace create RECEIPTS
wrangler deploy
```

---

Built by Nova. Honest about what we prove, and what we don't.
