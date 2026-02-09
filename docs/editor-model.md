**Editor Model**

**Goals**
- Generic designer with a limited component set.
- Deterministic layout that matches PDF output.
- Clean separation between canvas and property panel.

**Canvas**
1. The canvas is a fixed-size page in pt units.
2. Margins define the body area. Rulers align to body edges.
3. Elements are absolutely positioned within the body.

**Selection and Layering**
1. Single and multi-select.
2. Snap-to-grid and snap-to-guides.
3. z-index is managed in the layers panel.

**Component Library (v1)**
1. Text
2. Image
3. Table
4. QR code
5. Line
6. Box
7. Header/Footer blocks via `region` and `repeat`

**Shared Properties**
1. Position: `x`, `y`, `w`, `h`
2. Region: `header`, `body`, `footer`
3. Visibility: `visibleIf`
4. Style: `font`, `size`, `weight`, `color`, `align`, `lineHeight`, `border`, `fill`
5. Data binding: `{{path}}`

**Text Properties**
1. `text` (supports bindings)
2. `align` and `lineHeight`
3. `font`, `size`, `weight`, `color`

**Image Properties**
1. `src` (url or data)
2. `fit`: `contain`, `cover`, `fill`

**Table Properties**
1. `rows` binding path
2. `columns` with `header`, `field`, `w`, `align`, `format`
3. `rowStyle`, `headerStyle`
4. `pagination` with `mode` and `rowHeight`

**QR Properties**
1. `value` binding path
2. `ecc` level

**Line Properties**
1. `w`, `h`
2. `borderColor`, `borderWidth`

**Box Properties**
1. `borderColor`, `borderWidth`
2. `fill`

**Property Panel Layout**
1. Layout section for position and size.
2. Content section for component-specific fields.
3. Styling section for font and color.
4. Logic section for `visibleIf`.

**Drag and Drop Rules**
1. Elements cannot overlap margins.
2. Header/Footer elements are restricted to their regions.
3. Table height can auto-expand only in preview mode.

**Undo and Versioning**
1. Store history as a JSON patch list.
2. Template `version` is bumped on publish.
