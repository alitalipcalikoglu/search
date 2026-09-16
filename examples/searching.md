# Searching

```bash
scurl "$SEARCH/v1/indexes/products/search?q=kırmızı%20elb&limit=10"
```

```json
{
  "total": 2, "limit": 10, "offset": 0, "query": "\"kirmizi\" AND \"elb\"*",
  "hits": [
    { "id": "p1", "title": "Kırmızı Yazlık Elbise", "body": "…", "tags": ["elbise", "yaz"], "attrs": { "color": "red", … }, "url": "https://shop.example/p/p1", "source": "shop-backend", "createdAt": "…", "updatedAt": "…", "score": 0.0000173 },
    …
  ],
  "facets": {}
}
```

`POST /v1/indexes/products/search` takes the same options as JSON (`q`, `filters`, `facets`, `limit`, `offset`, `highlight`, `sort`) and is the better choice for anything beyond a plain query string.

## Query syntax

| Input | Meaning |
|---|---|
| `kırmızı elbise` | both words (AND), the last one as a prefix: `elbise`, `elbiseler` |
| `"kot pantolon"` | the phrase, in that order |
| `elbise -askısı` | `elbise` but not `askısı` |
| `mavi kot "yüksek bel"` | words and phrases mix |

Everything else is treated as plain words: `OR`, `NEAR`, `column:`, `*`, parentheses cannot break the query or reach FTS5 syntax. `query` in the response shows the expression that ran.

## Folding

Text is folded before indexing and before matching: case, diacritics and the Turkish dotted/dotless i. `kirmizi`, `KIRMIZI` and `Kırmızı` are the same word; `cilek` finds `Çilek`; `istanbul` finds `İstanbul`. Highlights still show the original spelling.

## Ranking

BM25 per field, weighted by the index's `weights`: a word in the title counts more than in the body, tags in between. Ties break by newest first. `score` is the raw (positive) BM25 value, comparable within one response only; use it to draw relevance bars, not to compare queries.

## Paging and sorting

`limit` up to `MAX_PAGE` (100), `offset` up to `MAX_OFFSET` (10 000). `sort=relevance` (default with a query), `newest`, `oldest`. An empty `q` browses the index with filters only, newest first.

## Empty results

`total: 0` is a normal answer. Show "no results for …" plus a suggestion to remove filters; do not retry.
