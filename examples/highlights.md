# Highlights and snippets

```bash
scurl "$SEARCH/v1/indexes/products/search?q=kırmızı%20astar&highlight=true"
```

Each hit gains:

```json
"highlights": {
  "title": "Siyah Deri Ceket",
  "body": "Gerçek deri, <mark>kırmızı</mark> <mark>astarlı</mark>. Kış için sıcak tutar."
}
```

- Query terms are wrapped in `<mark>…</mark>` in the **original** text (folding is only used to decide what matches, so `kirmizi` marks `Kırmızı`). Prefix terms mark the whole word (`astar` → `astarlı`).
- `title` is the full title; `body` is a window of about 160 characters around the first hit, with `…` where it was cut. No hit in the body → the beginning of the body.
- Everything else is HTML-escaped (`&`, `<`, `>`, `"`), so the strings can be inserted as HTML with only the marks active. Style `mark` in your CSS.

Highlights cost a pass over each hit's text; leave `highlight` off for counts-only or API-to-API calls.
