# API keys and roles

`SEARCH_API_KEYS=id:secret[:role[:indexes]],…`

| Role | Can | Give to |
|---|---|---|
| `write` | create, change, clear, delete indexes; upsert and delete documents | the backends that own the data |
| `read` | search, suggest, browse and read documents, list indexes, stats, metrics | site backends, dashboards |
| `readwrite` | both (default) | the admin console |

`indexes` scopes a key to named indexes, joined with `+`:

```env
SEARCH_API_KEYS=console:3f9a…,shop-backend:71cc…:write:products,shop-web:b02e…:read:products,docs:e6d1…:readwrite:help-center+docs
```

A scoped key sees only its indexes in `GET /v1/indexes` and `/v1/stats`, gets `403 FORBIDDEN` on any other, and may create only indexes named in its scope. Scopes may name indexes that do not exist yet.

The key id is recorded as `createdBy` on indexes and `source` on documents.

## Rate limit

`RATE_LIMIT_MAX` requests per key per minute (default 1 200); `429 RATE_LIMITED`.

## Responses

| Status | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or unknown secret; `WWW-Authenticate: Bearer`. |
| 403 | `FORBIDDEN` | Wrong role, or index outside the key's scope. |
| 400 | `VALIDATION_FAILED`, `INVALID_JSON` | Schema or JSON problems. |
| 400 | `INVALID_DOCUMENT`, `INVALID_QUERY` | Bad document content; bad query, filter, facet, weight or offset. |
| 404 | `INDEX_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `NOT_FOUND` | |
| 409 | `INDEX_EXISTS` | |
| 413 | `BATCH_TOO_LARGE`, `DOCUMENT_TOO_LARGE` | Above `MAX_BATCH` / `MAX_DOC_BYTES`. |
| 429 | `RATE_LIMITED` | |

Errors are always `{ "error": { "code", "message", "details?" } }`. Keys are compared in constant time against every configured secret.
