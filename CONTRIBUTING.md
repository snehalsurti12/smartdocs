# Contributing

Thanks for contributing to SmartDocs.

## Setup

```bash
npm install
npm run editor
```

## Development Rules

- Keep template schema and renderer behavior aligned.
- Add or update starter examples when you add new template features.
- Prefer small, focused pull requests.
- Include reproduction steps for bug fixes.

## Before Opening a PR

Run:

```bash
npm run check
```

And if your change affects PDF output:

```bash
npm run render:pdf -- --template examples/enterprise-cover-template.json --data examples/enterprise-cover-data.json --out out/enterprise-cover-render.pdf
```

## Pull Request Checklist

- [ ] Change is scoped and documented
- [ ] Schema updated (if needed)
- [ ] Editor and renderer both updated (if needed)
- [ ] Example template/data updated (if needed)
- [ ] Commands in README still valid
