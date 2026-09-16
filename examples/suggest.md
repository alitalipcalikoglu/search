# Suggestions

Type-ahead on titles, folded like search:

```bash
scurl "$SEARCH/v1/indexes/products/suggest?q=kırm&limit=5"
```

```json
{ "items": [{ "id": "p1", "title": "Kırmızı Yazlık Elbise" }, { "id": "p7", "title": "Kırmızı Şal" }] }
```

Every word typed must appear in the title, the last one as a prefix. Bodies and tags are not consulted, so suggestions stay short and recognisable. Debounce on the client (150–250 ms) and send at most one request in flight; see [integration](integration.md).
