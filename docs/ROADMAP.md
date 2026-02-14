# Roadmap

This roadmap is organized by product capability themes rather than isolated features.

## Theme 1: Core Editor Reliability

Goal: predictable authoring behavior and strong preview-to-PDF parity.

## v0.2 (Near-term)

- stable pagination parity between editor preview and PDF
- better table controls (row height presets, overflow diagnostics)
- undo/redo history in editor
- asset manager (logo/icon library with reusable references)
- richer layout tooling:
  - group/ungroup and lock/unlock
  - optional snap-to-grid
  - layer ordering controls
- improved starter template library

## Theme 2: Governance and Lifecycle

Goal: enterprise-safe template operations and controlled change management.

## v0.3 (Enterprise Foundation)

- template promotion pipeline (`dev` -> `uat` -> `prod`)
- approval workflow with comments
- change history and audit log hardening
- human-readable template version diffs/changelog

## Theme 3: Integrations and Delivery

Goal: make SmartDocs usable inside real business systems.

## v0.4 (Integrations)

- public API with auth and idempotent render jobs
- Salesforce mapping layer for source -> contract payload
- webhook callbacks + async job status endpoints
- storage adapters for rendered output + metadata

## Theme 4: AI and Agentic Workflows

Goal: reduce manual setup time and enable autonomous document operations with guardrails.

## v0.5 (AI + Agentic)

- template intelligence:
  - suggest/auto-map input fields from source schemas (Salesforce/CRM)
  - confidence scores + unresolved-field queue
- smart preflight checks:
  - detect missing fields, broken bindings, risky content changes
  - plain-English warnings before publish/send
- version diff intelligence:
  - explain what changed and potential downstream impact
- natural-language template bootstrap:
  - generate draft template structure from prompt + constraints
- MCP server surface (tool layer):
  - `list_templates`
  - `get_template`
  - `suggest_mapping`
  - `preflight_check`
  - `render_document`
  - `create_change_summary`

## Theme 5: Scale and Operations

Goal: production-grade runtime and operational confidence.

## v0.6 (Scale + Reliability)

- multi-tenant isolation model
- queue-based render workers
- expand golden regression coverage with visual diff checks
- observability: tracing, metrics, structured error taxonomy
- SLO-backed error budgets and runbooks

## Notes

- Timeline and scope can shift based on contributor velocity and feedback.
- Governance and deterministic validation remain first-class constraints for all AI features.
