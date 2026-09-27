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
