# Persistence Model (Postgres + Prisma)

This project uses a three-table core model for template lifecycle.

## Tables

- `Template`
  - Mutable metadata: name, status, current version pointer, audit ownership fields.
- `TemplateVersion`
  - Immutable template JSON snapshots (`contentJson`).
  - Unique per `(templateId, version)`.
- `AuditEvent`
  - Append-only change log for create/update/version actions.

## Design Rules

- Never update historical `TemplateVersion` rows in place.
- New edits create a new `TemplateVersion`.
- `Template.currentVersionId` points to active version.
- Every write path should append an `AuditEvent`.

## API Skeleton (Editor Server)

- `GET /api/templates`
- `POST /api/templates`
- `GET /api/templates/:id`
- `PATCH /api/templates/:id`
- `GET /api/templates/:id/versions`
- `POST /api/templates/:id/versions`
- `GET /api/templates/:id/audit`

## Next Hardening Steps

- Add actor identity from auth tokens (replace `actorId: editor/system`).
- Add approval and promotion tables (`EnvironmentPromotion`, `ApprovalRequest`).
- Add optimistic locking for concurrent edits.
- Add pagination and filtering for audit endpoints.
