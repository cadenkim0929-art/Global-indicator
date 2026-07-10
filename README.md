# EP Industry Monitor — Macro Indicator UI implementation

Target: `cadenkim0929-art/Global-indicator` commit `8bcf268ef46902b07025f3fff45ee9e6c703607e` (v4.12).

This overlay implements:

- dependency-free SVG sparklines in macro list cards
- list-style indicator navigation
- related-news macro highlight card
- independent `/indicators/[indicatorId]` routes
- frequency-aware range tabs and charts
- category-aware statistics and editorial descriptions
- GDP country bundle pages (`/indicators/gdp-korea`, etc.)
- existing light editorial CSS variables and Noto Sans KR theme

## Apply

From the repository root:

```bash
python3 /path/to/apply_macro_ui.py .
npm install
npm run build
```

Then review the changes and commit on a feature branch:

```bash
git checkout -b feat/macro-indicator-detail-ui
git add src/app/ui/dashboard.tsx src/lib/indicator-store.ts src/app/globals.css \
  src/app/ui/indicator-sparkline.tsx src/app/ui/indicator-detail.tsx \
  'src/app/indicators/[indicatorId]/page.tsx'
git commit -m "feat: add macro indicator sparklines and detail pages"
```

The script is intentionally strict: it stops when the expected v4.12 source anchors do not match, rather than silently corrupting a newer file.
