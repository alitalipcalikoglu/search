# Filters and facets

Attributes and tags are exact-match keys. Filters narrow the result set; facets count the values inside it.

## Filters

GET: `filter.<key>=v1,v2`. POST: `"filters": { "<key>": ["v1", "v2"] }`.

```bash
scurl "$SEARCH/v1/indexes/products/search?q=elbise&filter.brand=Mavi&filter.color=red,blue&filter.inStock=true"
```

- Values within one key are **OR** (`red` or `blue`).
- Keys are **AND** (brand Mavi *and* one of those colors *and* in stock).
- Array attributes match if any element matches: `filter.sizes=M` finds every document that lists `M`.
- Numbers and booleans are matched as strings: `filter.price=499`, `filter.inStock=true`. Ranges are not supported; bucket on the way in (`priceBand: "0-500"`).
- `filter.tags=yaz` filters by tag.

## Facets

`facets=brand,color` (GET) or `"facets": ["brand", "color"]` (POST):

```json
"facets": {
  "brand": [{ "value": "Mavi", "count": 12 }, { "value": "Koton", "count": 4 }],
  "color": [{ "value": "red", "count": 7 }, { "value": "blue", "count": 5 }, { "value": "black", "count": 4 }]
}
```

Counts are over the documents that match the query **and** the active filters, up to `MAX_FACET_VALUES` (20) values per key, most frequent first. Ask only for the keys you render; each is one extra query.

## A filter sidebar

1. First request: `q`, no filters, `facets` = the index's `facets` list → render every group with counts.
2. The user ticks `brand = Mavi`: request again with `filters.brand = ["Mavi"]` and the same `facets` → counts shrink to what is still reachable; `brand` now shows the other brands with their counts *within* the current selection.
3. Show active filters as removable chips; removing one re-requests.

Keep the facet keys in the index definition (`facets`) so every client renders the same groups; the console does exactly that.
