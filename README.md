# SmartDocs

Open-source document generation engine with a visual template editor, deterministic PDF rendering, and structured data binding.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/version-1.1.0-green)](https://github.com/snehalsurti12/smartdocs)

**[Try the Live Demo](https://smartdocs-production-b0fa.up.railway.app/)** — no signup, no install. Open the editor and start building templates instantly.

## Quick Start

```bash
npm install
npx playwright install chromium
npm run editor
```

Open [http://localhost:5177](http://localhost:5177), pick a sample template from the dropdown, and start editing.

### Docker

```bash
docker compose up --build
```

Starts the editor + Postgres at `http://localhost:5177`.

## Features

### Visual Template Editor
- Drag-and-drop component placement with snap guides
- 11 component types: Text, Long Text, Image, Table, QR Code, Barcode, Chart, Hyperlink, Line, Box, Page Break
- Multi-select, align, distribute tools
- Inline text editing with rich text support
- Reusable blocks (partials)
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- Live data preview with page navigation

### Rendering Engine
- Deterministic HTML and print-ready PDF output via Playwright
- Data binding with `{{field.path}}` merge syntax
- Data contracts with validation, transforms (currency, date, trim, etc.)
- Multi-page flow text with column support
- Auto-paginating tables with page-aware placement
- Conditional visibility (`visibleIf` expressions)
- Repeat modes: all pages, first only, continuation pages, etc.

### Components

| Component | Description |
|-----------|-------------|
| **Text** | Static or data-bound text with font/color/alignment controls |
| **Long Text** | Multi-page flowing text with column layout |
| **Image** | URL or data-bound images with fit modes |
| **Table** | Auto-paginating data tables with header repeat |
| **QR Code** | Real QR encoding (versions 1-10, all ECC levels) |
| **Barcode** | Code 128B with proper encoding and quiet zones |
| **Chart** | Bar, line, pie, and doughnut charts (SVG) |
| **Hyperlink** | Clickable links in PDF output |
| **Line** | Horizontal rules and separators |
| **Box** | Rectangles with fill, border, and rounded corners |
| **Page Break** | Explicit page break control |

### Users, Roles & Authentication
- Invite-only user management with bcrypt passwords and JWT sessions
- Four roles: **Author**, **Reviewer**, **Publisher**, **Admin**
- Login page with auto-redirect, user bar with avatar and role badge
- Admin settings panel for managing team, projects, and approval chains

### Projects
- Group templates into projects for scoped access
- Assign team members to specific projects
- Members can only see templates in their projects (Admin sees all)

### Multi-Level Approval Workflow
- Configurable approval chains per project (1 to N steps)
- Multiple chains per project — author picks at submit time
- Each step has a label, required role, and assigned approver
- Visual step builder for creating and editing chains
- Approve/reject at each level with comments and reasons
- Auto-publish when final step role is Publisher
- Approval stepper shows live progress (approved, pending, rejected)
- Full audit trail with timestamps, actors, and reasons

### Persistence
- Postgres via Prisma with template versioning and audit trail
- Template lifecycle: Draft → Review → Approved → Published → Archived
- Content locking on Approved/Published templates
- REST API when `DATABASE_URL` is set

## CLI

```bash
# Validate a template
npm run validate -- --template examples/template.json

# Render to HTML
npm run render -- --template examples/template.json --data examples/data.json --out out/render.html

# Render to PDF
npm run render:pdf -- --template examples/template.json --data examples/data.json --out out/render.pdf
```

## Sample Templates

| Template | What it showcases |
|----------|-------------------|
| Invoice Starter | Tables, data binding, QR codes |
| Credit Card Statement | Multi-page, branded headers, currency formatting |
| Bank Statement | Long tables, account summaries |
| Terms & Conditions | Flow text, multi-column layout |
| Enterprise Cover Package | Full-bleed design, styled boxes |
| Quarterly Business Report | Charts, barcodes, hyperlinks, images, KPI cards |
| Conference Event Pass | QR codes, schedules, Wi-Fi QR, venue info |

## Project Structure

```
editor/          Visual editor (vanilla JS), login, invite pages
scripts/         Renderer, PDF pipeline, auth, projects, approval, server
schemas/         Template JSON schema
examples/        Sample templates and data
prisma/          Database schema and migrations
salesforce/      Salesforce managed package (LWC, Apex)
landing/         Marketing site and industry use case pages
docs/            Specs and roadmap
```

## Database Setup

```bash
cp .env.example .env
npm run db:up
npm run prisma:migrate -- --name init_templates
npm run prisma:generate
```

The editor exposes APIs when `DATABASE_URL` is configured:

```
Auth:
POST       /api/auth/login              Email + password login
POST       /api/auth/logout             Invalidate session
GET        /api/auth/me                 Current user info
POST       /api/auth/accept-invite      Accept invite, set password

Users (Admin):
GET        /api/users                   List tenant users
POST       /api/users/invite            Invite user with role
PATCH      /api/users/:id               Update role/active
DELETE     /api/users/:id               Deactivate user

Projects:
GET/POST   /api/projects                List/create projects
GET/PATCH  /api/projects/:id            Get/update project
POST/DEL   /api/projects/:id/members    Add/remove members
GET/POST   /api/projects/:id/approval-chains  Manage approval chains

Templates:
GET/POST   /api/templates               List/create (supports projectId)
GET/PATCH  /api/templates/:id           Get/update metadata
GET/POST   /api/templates/:id/versions  Version history/save
POST       /api/templates/:id/transition Status transitions
GET        /api/templates/:id/audit     Audit trail

Approval:
POST       /api/templates/:id/submit    Submit for approval (chainId)
POST       /api/templates/:id/approve   Approve current step
POST       /api/templates/:id/reject    Reject with reason
GET        /api/templates/:id/approval  Approval status + steps
GET        /api/approvals/pending       Templates pending your review
```

## Known Limitations

- **QR codes**: Supports versions 1-10 (max ~271 characters). Very long URLs or payloads may be truncated.
- **Charts**: SVG-based rendering covers bar, line, pie, doughnut. No legends, axis labels, or tooltips yet.
- **Barcodes**: Code 128B only. EAN-13, UPC, and other symbologies are not yet implemented.
- **Undo/redo**: Snapshot-based (50 steps). Large templates may use more memory.
- **Browser support**: Editor tested in Chromium-based browsers. Firefox and Safari may have minor rendering differences.
- **PDF rendering**: Requires Playwright/Chromium. No server-side rendering without a headless browser.
- **Email notifications**: Approval assignments don't send email yet — reviewers check the pending reviews list.

## Roadmap

- Email notifications for approval assignments
- Conditional logic rule builder (visual UI for show/hide rules)
- Reusable content library (shared blocks across templates)
- Password reset flow
- HubSpot and ServiceNow native integrations
- Advanced table tooling and richer pagination controls
- Agentic/MCP tool surface for AI-driven document automation

See [docs/ROADMAP.md](docs/ROADMAP.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). High-value areas:
- Pagination and page-break controls
- Table authoring improvements
- Governance workflow primitives
- API and integration hardening

## License

[MIT](LICENSE)
