# Receipts Log

This directory auto-archives every receipt issued by the Receipt Protocol.

Each file is a JSON object with:
- id: receipt UUID
- agent_id: who issued it
- action: what they claim to have done
- platform: where it happened
- proof: optional link to evidence
- issued_at: timestamp
- signature: Ed25519 signature

Verify any receipt at: `GET /verify/:id`
