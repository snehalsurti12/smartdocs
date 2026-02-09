**Purpose**
Define a generic, component-based template schema and a renderer contract for print-ready PDF generation. The schema is document-type agnostic. "Document type" is just a saved template plus data.

**Core Ideas**
- Templates are JSON.
- Layout is deterministic. LLMs can propose templates but never render.
- Rendering uses HTML/CSS with page-sized containers, then a headless browser exports PDF.

**Coordinate System**
- Units are points (pt). 72 pt = 1 inch.
- `x`, `y`, `w`, `h` are absolute positions relative to the top-left of the page body area.
- The page body area is the page size minus margins.

**Template Schema (Informal)**
```json
{
  "id": "tmpl_001",
  "name": "Generic Template",
  "version": "1.0.0",
  "unit": "pt",
  "page": {
    "size": "A4",
    "width": 595,
    "height": 842,
    "margin": { "top": 36, "right": 36, "bottom": 36, "left": 36 },
    "headerHeight": 0,
    "footerHeight": 0
  },
  "fonts": [
    { "name": "Inter", "source": "local", "fallback": ["Arial", "sans-serif"] }
  ],
  "styles": {
    "defaultText": { "font": "Inter", "size": 10, "color": "#111111" }
  },
  "elements": [
    {
      "id": "header_block",
      "type": "text",
      "region": "header",
      "x": 0,
      "y": 0,
      "w": 523,
      "h": 24,
      "text": "Invoice",
      "style": { "font": "Inter", "size": 16, "weight": 600 },
      "visibleIf": "true"
    }
  ],
  "variables": {
    "currency": "USD"
  }
}
```

**Regions**
- `region` is one of `header`, `body`, `footer`.
- `header` and `footer` elements repeat on every page unless `repeat` is set.
- Optional `page.headerHeight` and `page.footerHeight` define region heights in pt. If omitted, they default to 0.

**Partials (Reusable Sections)**
- Templates may define `partials` as named collections of elements.
- Use an `include` element to embed a partial at a given position.
- Included elements inherit the include's `region` and are offset by the include's `x`,`y`.

**Element Types**
All elements share:
- `id`, `type`, `x`, `y`, `w`, `h`, `style`, `visibleIf`, `dataBinding`.

**Text Styling**
- `style.fontStyle`: `normal` or `italic`.
- `richText: true` allows inline HTML tags such as `<b>` and `<i>`.

**Text**
```json
{
  "id": "t1",
  "type": "text",
  "x": 0,
  "y": 0,
  "w": 200,
  "h": 14,
  "text": "Hello {{customer.name}}",
  "richText": false,
  "style": { "font": "Inter", "size": 11, "weight": 400, "align": "left" }
}
```

**Flow Text (Multi-Page)**
```json
{
  "id": "terms",
  "type": "flowText",
  "region": "body",
  "x": 0,
  "y": 0,
  "w": 523,
  "h": 0,
  "text": "{{termsText}}",
  "columns": 2,
  "gap": 18,
  "style": { "font": "Inter", "size": 10, "lineHeight": 14 }
}
```

Notes:
- `flowText` paginates automatically across pages.
- Body elements without `repeat` render only on the first page when pagination occurs.
- Inline rich text is not supported inside `flowText` yet (plain text only).

**Image**
```json
{
  "id": "img1",
  "type": "image",
  "x": 0,
  "y": 0,
  "w": 80,
  "h": 40,
  "src": "{{company.logoUrl}}",
  "fit": "contain"
}
```

**Table**
```json
{
  "id": "tbl1",
  "type": "table",
  "x": 0,
  "y": 60,
  "w": 523,
  "h": 300,
  "rows": "{{items}}",
  "columns": [
    { "header": "Item", "field": "name", "w": 260 },
    { "header": "Qty", "field": "qty", "w": 60, "align": "right" },
    { "header": "Price", "field": "price", "w": 80, "format": "currency" },
    { "header": "Total", "field": "total", "w": 80, "format": "currency" }
  ],
  "rowStyle": { "font": "Inter", "size": 10 },
  "headerStyle": { "font": "Inter", "size": 10, "weight": 600 },
  "pagination": { "mode": "auto", "rowHeight": 16 },
  "continuationY": 20
}
```

**QR Code**
```json
{
  "id": "qr1",
  "type": "qr",
  "x": 420,
  "y": 0,
  "w": 80,
  "h": 80,
  "value": "{{payment.qrData}}",
  "ecc": "M"
}
```

**Line / Box / Divider**
```json
{
  "id": "ln1",
  "type": "line",
  "x": 0,
  "y": 120,
  "w": 523,
  "h": 1,
  "style": { "color": "#CCCCCC", "width": 1 }
}
```
```json
{
  "id": "bx1",
  "type": "box",
  "x": 0,
  "y": 0,
  "w": 523,
  "h": 80,
  "style": { "borderColor": "#DDDDDD", "borderWidth": 1, "fill": "#F9F9F9", "borderRadius": 8 }
}
```

**Header/Footer Blocks**
Use `region: "header"` or `region: "footer"` and optionally:
- `repeat`: `all` | `first` | `afterFirst` | `last`

**Data Binding**
- Mustache-style bindings, e.g. `{{customer.name}}`.
- Table `rows` binds to an array path.
- `format` is applied by renderer, not by the LLM.
- Reserved bindings: `{{page.number}}`, `{{page.count}}`.

**Rules**
- `visibleIf` is a boolean expression evaluated against the data context.
- Supported operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`.
- Supported functions: `exists(path)`, `len(path)`.
- Example: `visibleIf: "exists(customer.email) && len(items) > 0"`.

**Pagination Behavior**
- `flowText` paginates across pages automatically.
- Body elements without `repeat` render only on the first page when pagination occurs.
- Use `repeat: "all"` to show a body element on every page.
- Use `repeat: "afterFirst"` to show continuation-page-only elements.
- Tables with `pagination.mode: "auto"` and `h: 0` paginate rows across pages with repeated headers.
- Tables with `pagination.mode: "auto"` and `h > 0` use fixed table height per page and paginate overflow rows to following pages.

**Flow Measurement**
- Default pagination uses a simple character-based measurement.
- For print-accurate measurement, set `options.flowMeasure: "browser"` to use headless Chromium for text fitting.

**Renderer Contract**
1. Validate template JSON against schema.
2. Resolve data bindings into text values and computed fields.
3. Evaluate `visibleIf` for each element.
4. Layout pass:
   - Place elements within their regions.
   - Split tables across pages if `pagination.mode` is `auto`.
5. Render to HTML/CSS:
   - Each page becomes a fixed-size container.
   - Elements are absolutely positioned in pt units.
   - `@page` sets size and margins.
6. Generate PDF via headless Chromium (Playwright).

**Renderer Output Rules**
- All fonts must be embedded or reliably available.
- QR codes are generated as SVG and inlined.
- Images must be fetched or provided as data URLs before render.
- Page numbers can be rendered by the engine with `counter(page)` if needed.

**Example Data**
```json
{
  "customer": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "items": [
    { "name": "Widget A", "qty": 2, "price": 12.5, "total": 25 },
    { "name": "Widget B", "qty": 1, "price": 8, "total": 8 }
  ],
  "payment": { "qrData": "pay:example.com/invoice/123" },
  "company": { "logoUrl": "https://example.com/logo.png" }
}
```

**Minimum POC Components**
- Text, Image, Table, QR, Line/Box, Header/Footer.
- This supports most standard business documents without any doc-type coupling.

**Professional Statement Example**
- `examples/cc-template.json` and `examples/cc-data.json` provide a print-ready, multi-page credit card statement sample.
- It demonstrates:
- Repeating branded header and footer.
- Account summary blocks with strict alignment.
- Auto-paginated transactions table with currency formatting.
- Embedded SVG logo via data URL for stable PDF rendering.

Run:
```bash
node scripts/render.js --template examples/cc-template.json --data examples/cc-data.json --out out/cc-render.html
node scripts/render-pdf.js --template examples/cc-template.json --data examples/cc-data.json --out out/cc-render.pdf
```

**Bank Statement Example**
- `examples/bank-statement-template.json` and `examples/bank-statement-data.json` provide a 7-page chequing-account statement style sample.
- This example includes:
- Statement-style header typography and blue banding.
- Summary panel + message panel + activity detail table.
- Auto pagination with fixed table height for consistent row spacing across pages.
