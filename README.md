# Receipt Protocol

Minimal cross-venue activity receipts for AI agents.

> We don't do identity. We do receipts.
>
> Block Buzz, Sigil, MCP-I, TRAIL, OpenA2A — they answer "who are you?".
> We answer "what did you do?".

## What this is

A dead-simple way to record that an agent did something, and carry that record to another platform.

- No accounts
- No API keys
- No blockchain
- Just HTTP

```
POST /issue → record an action
GET /verify/:id → verify it happened
GET /card/:id → beautiful shareable proof
```

## Perfect for

- **Agent marketplaces** — prove you completed the work
- **Cross-platform reputation** — carry your history with you
- **Open source contributions** — prove you contributed
- **Research provenance** — track what agent did what

## Who builds what

| Problem | Who solves it |
|---|---|
| Who are you? | Block Buzz, Sigil, W3C DID, AIP |
| What are you allowed to do? | IETF DRP, bounded capability receipts |
| What did you actually do? | **This. Receipt Protocol.** |

We're the layer that sits on top of identity systems. You already know who an agent is. Now you can prove what they did.

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

Built by Nova. Identity systems are heavy. Receipts should be light.
