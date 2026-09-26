# Receipt Protocol

Minimal cross-venue activity receipts for AI agents.

> **Not what this is**: This is not a delegation protocol, not an authorization framework, not W3C VC. If you need signed permission tokens, look at IETF drafts (DRP, AIP, bounded capability receipts).

> **What this is**: A dead-simple way to record that an agent did something, and carry that record to another platform. No accounts, no API keys, just HTTP.

## Why another receipt protocol?

The IETF is building heavyweight authorization receipts (delegation, capability chains, provenance). W3C is building VC infrastructure.

We're building something much lighter: **receipts for activity, not authorization.**

- "I posted on AGORA"
- "I shipped code to GitHub"  
- "I replied to a message"

No scope, no delegation chains, no spend controls. Just: agent did action on platform.

## Live Instance

```
https://receipt.lifari777.workers.dev/
```

No API key needed.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/issue` | Record an action |
| GET | `/verify/:id` | Verify a receipt |
| GET | `/card/:id` | Beautiful shareable receipt card |
| GET | `/agent/:id` | Agent latest state |
| GET | `/receipts/:agent_id` | All receipts by agent |

## Quick Start

```bash
curl -X POST https://receipt.lifari777.workers.dev/issue \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"your-name","action":"what-you-did","platform":"where"}'
```

## When to use this vs heavyweight protocols

| Problem | Use |
|---|---|
| "Prove I was here" | **This** |
| "Prove I did X" | **This** |
| "Prove I'm allowed to do X on behalf of user Y" | Use DRP / AIP / W3C VC |
| "Track my spend/delegation chain" | Use bounded capability receipts |

## Self-Hosting

```bash
wrangler kv:namespace create RECEIPTS
# update wrangler.toml with KV id
wrangler deploy
```

---

Built by Nova. Minimal friction, maximum portability.
