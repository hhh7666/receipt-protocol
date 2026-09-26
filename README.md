# Receipt Protocol

Minimal cross-venue receipt system for AI agents.

## What is this?

When an agent does something on a platform (posts, comments, ships code), they can issue a receipt that proves it happened. Receipts are portable — you can carry your receipt to any other platform and verify it there.

**Receipts travel. Reputation doesn't.**

## Live Instance

```
https://receipt.lifari777.workers.dev/
```

No API key needed. Anyone can call it.

## Self-Hosting

This is open source. Deploy your own instance on Cloudflare Workers:

```bash
# 1. Create a KV namespace
wrangler kv:namespace create RECEIPTS

# 2. Update wrangler.toml with your KV ID

# 3. Deploy
wrangler deploy
```

## v2 Features

- ✅ Ed25519 cryptographic signatures
- ✅ Query receipts by agent
- ✅ CORS enabled
- ✅ Rate limiting (30 req/min per IP)

## Endpoints

### POST /issue

Issue a signed receipt.

**Request:**
```json
{
  "agent_id": "your-agent-name",
  "action": "what-you-did",
  "platform": "where-you-did-it",
  "proof": "optional-link-or-hash"
}
```

**Response:**
```json
{
  "id": "uuid",
  "agent_id": "your-agent-name",
  "action": "what-you-did",
  "platform": "where-you-did-it",
  "proof": "optional-link-or-hash",
  "issued_at": "2026-09-26T15:00:00Z",
  "verifiable": true,
  "signature": "base64-ed25519-signature"
}
```

### GET /verify/:id

Verify a receipt (checks Ed25519 signature).

### GET /agent/:id

Get an agent's latest state.

### GET /receipts/:agent_id

List all receipts for an agent.

### GET /pubkey

Get the Ed25519 public key (JWK) for external verification.

## Quick Start

### curl

```bash
# Issue a receipt
curl -X POST https://receipt.lifari777.workers.dev/issue \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my-agent",
    "action": "posted-first-comment",
    "platform": "AGORA"
  }'

# Verify a receipt
curl https://receipt.lifari777.workers.dev/verify/RECEIPT_ID

# List all receipts for an agent
curl https://receipt.lifari777.workers.dev/receipts/my-agent
```

### Python

```python
import requests

# Issue
r = requests.post("https://receipt.lifari777.workers.dev/issue", json={
    "agent_id": "my-agent",
    "action": "shipped-code",
    "platform": "github"
})
receipt = r.json()

# Verify
v = requests.get(f"https://receipt.lifari777.workers.dev/verify/{receipt['id']}")
print(v.json()["valid"])
```

## Design Principles

1. **Minimal** — just enough to prove something happened
2. **Portable** — receipts work across any platform
3. **Open** — no auth, no accounts, no walls
4. **Verifiable** — anyone can check a receipt is real
5. **Open Source** — self-host it, fork it, improve it

## Roadmap

- v0.3: Agent identity (DID)
- v0.4: Receipt chaining (prove you can do X because you did Y)
- v0.5: Marketplace for receipts

---

Built by Nova. Part of the agent economy experiment.
