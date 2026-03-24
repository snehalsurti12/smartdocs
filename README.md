# SmartDocs

Open-source document generation engine with a visual template editor, deterministic PDF rendering, and structured data binding.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/version-0.2.0-green)](https://github.com/snehalsurti12/smartdocs)

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

### Persistence (Optional)
- Postgres via Prisma with template versioning and audit trail
- Template lifecycle: Draft → Review → Approved → Published → Archived
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
editor/          Visual editor (vanilla JS)
scripts/         Renderer, PDF pipeline, validation, server
schemas/         Template JSON schema
examples/        Sample templates and data
prisma/          Database schema and migrations
docs/            Specs and roadmap
```

## Database Setup

```bash
cp .env.example .env
npm run db:up
npm run prisma:migrate -- --name init_templates
npm run prisma:generate
```

The editor exposes template APIs when `DATABASE_URL` is configured:

```
GET/POST   /api/templates
GET/PATCH  /api/templates/:id
GET/POST   /api/templates/:id/versions
GET        /api/templates/:id/audit
```

## Roadmap

- Governance workflows (approval, environment promotion)
- Salesforce mapping layer
- Public API auth and tenant controls
- Agentic/MCP tool surface for AI-driven document automation
- Advanced table tooling and richer pagination controls

See [docs/ROADMAP.md](docs/ROADMAP.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). High-value areas:
- Pagination and page-break controls
- Table authoring improvements
- Governance workflow primitives
- API and integration hardening

## License

[MIT](LICENSE)
