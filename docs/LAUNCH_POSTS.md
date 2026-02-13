# Launch Posts

Use these as starting drafts for announcing SmartDocs.

## LinkedIn Post (Long)

I just open-sourced **SmartDocs (alpha)**: a template-driven document designer + renderer for enterprise-style communications.

What it does today:
- visual template editor (true drag/drop, move/resize, inline text)
- multi-select + align/distribute + snap guides
- structured JSON data binding with contract mapping
- multi-page rendering with repeatable headers/footers
- print-ready HTML + PDF generation
- starter templates (invoice, statement, terms, enterprise communication pack)

Why I built it:
- most open examples focus on basic forms/invoices
- enterprise communication layouts need tighter pagination and layout control

Repo: https://github.com/snehalsurti12/smartdocs

This is `alpha` and not production-hardened yet.
Feedback and contributions are welcome.

## X Post (Short)

Open-sourced: **SmartDocs (alpha)**  
Template designer + renderer for enterprise-style docs.  
Drag/drop editor, JSON data contract mapping, multi-page headers/footers, HTML/PDF output.

Repo: https://github.com/snehalsurti12/smartdocs

## Hacker News / Reddit Post

Title:
`Show HN: SmartDocs – Open-source enterprise-style document template editor + PDF renderer`

Body:
I open-sourced SmartDocs (alpha), a template-driven document generation tool focused on enterprise communication layouts.

Current features:
- visual editor for template layout
- true drag/drop from palette to canvas
- multi-select, align/distribute, and snap guides
- JSON binding and data contract mapping
- multi-page rendering with repeat modes (`first`, `afterFirst`, `middle`, `last`, `all`)
- HTML and PDF generation
- schema validation + starter templates

It is still alpha, but I wanted to release early for feedback on architecture and feature direction.

Repo: https://github.com/snehalsurti12/smartdocs

## 5-Minute Demo Script

1. Open editor: run `npm install`, then `npm run editor`.
2. Load starter: choose `Enterprise Cover Package`.
3. Toggle preview data and show bindings in property panel.
4. Move one element and inline-edit one text element.
5. Drag one component from palette and align it with another component.
6. Multi-select two elements and use one align action.
7. Export JSON template.
8. Click `Preview PDF` and show multi-page output.
9. Close with:
same template can be fed by any upstream system that produces the contract JSON.
