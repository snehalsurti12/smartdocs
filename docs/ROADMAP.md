# Roadmap

## v0.2 (Near-term)

- Stable pagination parity between editor preview and PDF
- Better table controls (row height presets, overflow diagnostics)
- Undo/redo history in editor
- Asset manager (logo/icon library with reusable references)
- More layout tooling:
  - group/ungroup and lock/unlock
  - optional snap-to-grid
- Improved starter template library

## v0.3 (Enterprise Foundation)

- Template promotion pipeline (`dev` -> `uat` -> `prod`)
- Approval workflow with comments
- Change history and audit log

## v0.4 (Integrations)

- Public API with auth and idempotent render jobs
- Salesforce mapping layer for source -> contract payload
- Webhook callbacks + async job status endpoints

## v0.5 (Scale + Reliability)

- Multi-tenant isolation model
- Queue-based render workers
- Golden-file regression tests for layout stability
- Observability: tracing, metrics, structured error taxonomy
