**Renderer Spec**

**Goals**
- Deterministic HTML/CSS output.
- Pixel-accurate PDF export.
- Consistent pagination for tables and headers/footers.

**Input**
- Template JSON validated against `schemas/template.schema.json`.
- Data JSON used for bindings and rule evaluation.

**Phases**
1. Validate the template.
2. Resolve data bindings.
3. Evaluate `visibleIf`.
4. Layout and paginate.
5. Render HTML/CSS.
6. Generate PDF with headless Chromium.

**Binding Resolution**
1. Resolve `{{path.to.value}}` with a strict JSON path resolver.
2. Missing paths resolve to empty string.
3. `format` is applied after resolution.

**Rule Evaluation**
1. Parse `visibleIf` with a small expression parser.
2. Only allow `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`.
3. Helper functions: `exists(path)`, `len(path)`.

**Layout and Pagination**
1. Create a page object for each page.
2. Header/footer elements repeat based on `repeat`.
3. Tables with `pagination.mode = auto` are split across pages.
4. Table headers repeat on new pages if present.

**HTML Structure**
1. One `div.page` per page.
2. Page size is fixed in pt.
3. Elements are absolutely positioned.

**CSS Requirements**
1. Use `@page` to set size and margins.
2. Use `position: absolute` for elements.
3. All sizes in pt.

**Example HTML Skeleton**
```html
<html>
  <head>
    <style>
      @page { size: 595pt 842pt; margin: 36pt; }
      body { margin: 0; }
      .page { width: 595pt; height: 842pt; position: relative; }
      .el { position: absolute; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="el" style="left:0pt; top:0pt; width:200pt; height:14pt;">Hello</div>
    </div>
  </body>
</html>
```

**PDF Export**
1. Use Playwright to render HTML.
2. Use `print` media type and `format` set to `A4` or explicit size.
3. Embed fonts or use local system fonts.

**Error Handling**
1. Validation errors return a structured list.
2. Binding errors are warnings unless marked `required`.
3. Rendering errors include the element id.
