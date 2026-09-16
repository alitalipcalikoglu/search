# Indexes

An index is a named collection of documents with its own ranking weights and facet keys. Create one per kind of thing you search: `products`, `articles`, `help-center`.

```bash
scurl -X POST $SEARCH/v1/indexes -d '{
  "name": "products",
  "description": "Shop catalogue",
  "weights": { "title": 8, "body": 1, "tags": 3 },
  "facets": ["brand", "color", "tags"]
}'
```

`201` with `Location: /v1/indexes/products`:

```json
{ "index": { "name": "products", "description": "Shop catalogue", "weights": { "title": 8, "body": 1, "tags": 3 }, "facets": ["brand", "color", "tags"], "documents": 0, "lastIndexedAt": null, "searchesSinceStart": 0, "createdBy": "console", "createdAt": "2026-09-17T10:00:00.000Z", "updatedAt": "…" } }
```

- `name`: lower-case segments joined by `.`, `-` or `_`; permanent.
- `weights`: how much a hit in each field counts in BM25 ranking (0–100). Defaults `title 5, body 1, tags 3`. A title hit outranks the same word in the body.
- `facets`: attribute keys a UI should offer as filter groups. Informational: any attribute can be filtered or faceted at query time; this list is what the console shows by default.

`GET /v1/indexes` lists every index the key may see with document counts; `GET /v1/indexes/:name` one of them; `PATCH /v1/indexes/:name` changes description, weights or facets (changing weights needs no reindex, ranking uses them at query time).

## Clear and delete

```bash
scurl -X POST $SEARCH/v1/indexes/products/clear     # { "removed": 4210 }  keeps the index definition
scurl -X DELETE $SEARCH/v1/indexes/products         # 204, documents included
```

Clear before a full reindex when documents may have disappeared from the source; a plain upsert never removes anything.
