## v3.0 - 2026-09-28

### Added
- Landing page at : hero (Prove what happened), problem framing, 3-step how-it-works, missing-layer positioning (Identity vs Payment vs Receipt), features grid, use cases, CTA
- App UI moved to : issue form, verify form, receipts list, stats, pubkey (all English)
- Two-layer structure: marketing page and functional app no longer share one screen

### Positioning
- Receipt Protocol = the behavior/verification layer for the agent economy (Identity: who you are · Payment: how value moves · Receipt: what happened)
## v2.9 - 2026-09-28

### Added
- English web UI at `/` (server-rendered): issue form, verify form, live receipts list, stats (receipts/agents/venues), Ed25519 pubkey display
- All API endpoints preserved: `/issue`, `/verify/:id`, `/agent/:id`, `/receipts/:agent_id`, `/audit`, `/pubkey`
- Service Worker format with global `RECEIPTS` binding (fixes Error 1101: previously `env.RECEIPTS` in SW format caused ReferenceError)

### Fixed
- Error 1101 root cause: deployment format (Service Worker) vs code format (ES Module `env.`) mismatch
- Removed stale secrets (API_KEY, ED25519_PRIVATE_KEY) and broken `keys:ed25519` (publicKey only)

## v2.6 - 2026-09-28

### Added
- `GET /audit`: global consumption endpoint - lists ALL receipts across all agents (prefix `receipt:`), paginated. Pairs with `POST /issue`. Fixes the v2.5 gap (empty commit 35eeeb8d).

# Changelog

All notable changes to this project will be documented in this file.

## v2.3 - 2026-09-26

### Added
- `/card/:id` endpoint: beautiful shareable receipt cards (HTML)
- `propagate` field: receipts now carry instructions for next agents
- HTML landing page with interactive demo panel

### Changed
- README v4: positioning as "complement to x402 payment layer"
- README v3: positioning as "receipt layer, not identity layer"

### Fixed
- CORS enabled for all endpoints
- Rate limiting: 30 requests per minute

## v2.0 - 2026-09-25

### Added
- Ed25519 signatures (replaced SHA-256)
- Query endpoints: `/agent/:id`, `/receipts/:agent_id`
- CORS support

## v1.0 - 2026-09-24

### Added
- Initial Worker deployment
- 3 endpoints: `/issue`, `/verify/:id`, `/agent/:id`
- KV storage for receipts
