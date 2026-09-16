# Indexing documents

Documents are upserted in batches; each request is one transaction, so either every document lands or none.

```bash
scurl -X PUT $SEARCH/v1/indexes/products/documents -d '{
  "documents": [
    { "id": "p1", "title": "Kırmızı Yazlık Elbise", "body": "Pamuklu, hafif ve rahat. Yaz akşamları için ideal.",
      "tags": ["elbise", "yaz"], "attrs": { "color": "red", "brand": "Mavi", "price": 499, "sizes": ["S", "M", "L"], "inStock": true },
      "url": "https://shop.example/p/p1" },
    { "id": "p2", "title": "Mavi Kot Pantolon", "body": "Slim fit, yüksek bel.", "tags": ["pantolon"], "attrs": { "color": "blue", "brand": "Mavi", "price": 899 } }
  ]
}'
```

`200 { "created": 2, "updated": 0 }`. Sending `p1` again replaces it entirely (`updated: 1`); there is no partial update, send the whole document.

## The document

| Field | Rules |
|---|---|
| `id` | your identifier, 1–200 chars, unique per index |
| `title` | required; searched with the highest weight, used for suggestions |
| `body` | optional; searched, snippeted in highlights |
| `tags` | optional strings; searched (weight `tags`) **and** filterable/facetable under the key `tags` |
| `attrs` | optional object of strings, numbers, booleans or arrays of strings; **not searched**, but every value is filterable and facetable (numbers and booleans as their string form: `"499"`, `"true"`) |
| `url` | optional, returned as is, for result links |

Limits: `MAX_BATCH` documents per request (default 500), `MAX_DOC_BYTES` per encoded document (64 KiB), `MAX_ATTRS` attribute values per document (array elements count). Errors name the offending document: `documents[3].title is required`.

## Keeping an index in sync

Index from the place that owns the data:

- on create/update: upsert the one document (a batch of one is fine);
- on delete: `DELETE /v1/indexes/products/documents/p1`;
- nightly or after a migration: a full pass in batches of 500, then delete what the source no longer has (or `clear` first and re-upsert everything, accepting a short window of empty results).

The `search` service never reads your database; it only knows what you send. The [scheduler](https://github.com/alitalipcalikoglu/scheduler) can trigger your reindex endpoint on a schedule.

## Reading back

```bash
scurl $SEARCH/v1/indexes/products/documents/p1                 # one document as stored
scurl "$SEARCH/v1/indexes/products/documents?limit=50&offset=0" # browse, newest first
```
