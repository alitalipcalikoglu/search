# search examples

Scenario-driven walkthroughs of every feature. Requests to `/v1/*` need `Authorization: Bearer <secret>` from `SEARCH_API_KEYS`. Base URL below is `http://localhost:3010`.

| Example | Shows |
|---|---|
| [Indexes](indexes.md) | Creating an index, field weights, facet keys, clearing and deleting |
| [Indexing documents](indexing.md) | Bulk upsert, the document shape, attributes and tags, all-or-nothing batches, keeping an index in sync |
| [Searching](searching.md) | Query syntax, ranking, prefix matching, Turkish and accented text, paging, sorting |
| [Filters and facets](filters-and-facets.md) | Attribute filters, arrays, facet counts over the matched set, a filter sidebar |
| [Highlights and snippets](highlights.md) | Marked titles and body snippets in the original spelling |
| [Suggestions](suggest.md) | Type-ahead on titles |
| [Site search integration](integration.md) | A backend endpoint and a client that debounces, handles errors and falls back |
| [API keys and roles](keys-and-roles.md) | Read, write, readwrite; scoping a key to indexes; error codes |
| [Operations](operations.md) | Health, readiness, metrics, environment, PM2, Docker, backups, reindexing |

Set up once for the examples:

```bash
export SEARCH=http://localhost:3010
export KEY=<a readwrite secret from SEARCH_API_KEYS>
alias scurl='curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json"'
```
