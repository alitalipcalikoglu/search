# search

Full-text search over your own data, without an external engine: named indexes, bulk-indexed documents, BM25-ranked queries with field weights, attribute filters and facet counts, highlighted results in the original spelling, type-ahead suggestions. Case, diacritics and the Turkish dotted/dotless i are folded, so `kirmizi` finds `Kırmızı`. HTTP only.

Runtime dependencies: `fastify`, `@fastify/rate-limit`. Storage and search are SQLite with FTS5 via `node:sqlite` (built into Node 22.13+). The folder is self-contained: copy it to any host with Node 22 and run.

## Run

```bash
cp .env.example .env        # set SEARCH_API_KEYS
npm ci
npm run dev
```

Production with PM2 (reads `./.env` through Node's `--env-file`):

```bash
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

Production with Docker (mount the database directory):

```bash
docker build -t atc-search .
docker run -p 3010:3010 -v search-data:/data --env-file .env atc-search
```

Tests and type check:

```bash
npm test
npm run typecheck
```

## Model

- **An index** (`products`, `articles`) holds documents and carries ranking `weights` for `title`, `body` and `tags` plus a list of `facets` keys that UIs offer as filter groups.
- **A document** is `{ id, title, body?, tags?, attrs?, url? }`. Title, body and tags are searched; tags and every scalar in `attrs` (array elements included) are exact-match keys for filters and facets. Documents are upserted in batches of up to `MAX_BATCH`, each request one transaction.
- **A search** takes words (AND), `"phrases"` and `-exclusions`; the last word matches as a prefix so results appear while typing. Ranking is weighted BM25, ties newest first; `sort=newest|oldest` and an empty query browse. Filters are AND across keys and OR within a key; facets count values over the matched set.
- **Folding**: text is indexed and matched after lower-casing, removing diacritics and unifying `ı/İ/i`; highlights mark the original text and are HTML-escaped around `<mark>`.
- **Keys** are `id:secret[:role[:indexes]]`: roles `read` / `write` / `readwrite`; an index scope hides and protects every other index.

## Boundaries

**Purpose:** full-text search over documents other services index into it.

**Responsibilities:** index and document CRUD; BM25-ranked search with highlights and facets; prefix suggestions.

**Non-responsibilities:** not the system of record for indexed documents — the owning service's own database stays authoritative; search only holds a denormalized copy for querying, and losing it never loses data. Not a general analytics or aggregation engine beyond facet counts.

## API

Errors are JSON: `{ "error": { "code", "message", "details?" } }`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health`, `/ready`, `/v1/info` | none | Liveness; readiness (database, cached 10 s); service identity (version, API version, capabilities, schema version, service-core version). |
| POST | `/v1/indexes` | write | `{ name, description?, weights?, facets? }` → `201 { index }`. |
| GET | `/v1/indexes`, `/v1/indexes/:name` | read | Visible indexes with document counts; one index. |
| PATCH / DELETE | `/v1/indexes/:name` | write | `{ description?, weights?, facets? }`; delete with its documents. |
| POST | `/v1/indexes/:name/clear` | write | Remove every document, keep the index → `{ removed }`. |
| PUT | `/v1/indexes/:name/documents` | write | `{ documents: [...] }` upsert → `{ created, updated }`. |
| GET | `/v1/indexes/:name/documents` | read | Browse newest first (`limit`, `offset`). |
| GET / DELETE | `/v1/indexes/:name/documents/:id` | read / write | One document; delete. |
| GET | `/v1/indexes/:name/search` | read | `q`, `limit`, `offset`, `highlight`, `facets=a,b`, `sort`, `filter.<key>=v1,v2`. |
| POST | `/v1/indexes/:name/search` | read | `{ q?, filters?, facets?, limit?, offset?, highlight?, sort? }`, same result: `{ total, hits, facets, query }`. |
| GET | `/v1/indexes/:name/suggest` | read | `q`, `limit` → titles that start with the typed words. |
| GET | `/v1/stats` | read | Indexes, documents, searches since start, database size. |
| GET | `/metrics` | read | Prometheus text. |

Error codes: `INDEX_NOT_FOUND`, `INDEX_EXISTS`, `DOCUMENT_NOT_FOUND`, `INVALID_DOCUMENT`, `INVALID_QUERY`, `BATCH_TOO_LARGE`, `DOCUMENT_TOO_LARGE`, `VALIDATION_FAILED`, `INVALID_JSON`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`.

### Index and search in two calls

```bash
curl -s -X PUT http://localhost:3010/v1/indexes/products/documents -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "documents": [{ "id": "p1", "title": "Kırmızı Yazlık Elbise", "body": "Pamuklu, hafif.", "tags": ["yaz"], "attrs": { "brand": "Mavi", "color": "red" } }] }'
curl -s "http://localhost:3010/v1/indexes/products/search?q=kirmizi&highlight=true&facets=brand" -H "Authorization: Bearer $KEY"
```

## Examples

Scenario walkthroughs for every feature live in [examples/](examples/README.md), including a [site search integration](examples/integration.md) with backend endpoint and debounced client.

## Configuration

All settings come from environment variables and are validated at startup. See [.env.example](.env.example). Required: `SEARCH_API_KEYS`.

## Security notes

- API keys compared in constant time; per-key rate limit; read/write roles checked before body validation; index scoping on every endpoint that names an index, including listings and stats.
- User queries are tokenised and quoted before reaching FTS5: no operator, column filter or wildcard from the input runs as syntax.
- Highlights are HTML-escaped; only the `<mark>` tags are markup.
- Documents are bounded (`MAX_DOC_BYTES`, `MAX_ATTRS`), batches bounded (`MAX_BATCH`), pages and offsets bounded (`MAX_PAGE`, `MAX_OFFSET`), bodies capped (`BODY_LIMIT`); unknown fields rejected.
- `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on every response; container runs as the unprivileged `node` user.

## Code layout

Class-based; dependencies are injected through constructors, `src/application.js` is the composition root.

| Class | File | Role |
|---|---|---|
| `Application` | `src/application.js` | Wiring, startup, graceful shutdown |
| `Config` | `src/config.js` | Validated environment, key roles and index scopes |
| `Database` | `src/db.js` | SQLite connection, FTS5 table, migrations, transactions |
| `IndexStore`, `DocumentStore` | `src/store/` | Index definitions; documents with their full-text and attribute rows, search SQL |
| `SearchService` | `src/domain/search-service.js` | Index lifecycle, document validation, batch upsert, search, facets, suggestions |
| `QueryParser`, `TextFold`, `Highlighter` | `src/domain/` | Safe FTS5 expressions, folding, marks and snippets |
| `SearchApi`, `ApiKeyAuth`, `Schemas`, `Views` | `src/http/` | Fastify routes, roles and scopes, shapes |

## Out of scope by design

- Typo tolerance / fuzzy matching: prefix matching covers the type-ahead case; add a synonyms pass on your side if needed.
- Numeric ranges and geo: bucket values into strings when indexing (`priceBand`, `city`).
- Per-document permissions: use one index per audience, or filter by an `audience` attribute from a trusted backend.
- Language-specific stemming: folding and prefix matching go a long way; stemming would need per-language rules.
- Cluster / replication: one process per database file; split indexes across instances to scale.

## Audit events

With `AUDIT_URL` and `AUDIT_API_KEY` set, every completed write request is forwarded to the audit service as one event (`success`, or `denied` on 403) with the calling key as actor, the affected entity as target, client IP, user agent and request id. Events are buffered and sent in batches; the audit service being down never fails a request. Actions: see [examples/audit-events.md](examples/audit-events.md).

## Scaling model

**B — single-node stateful.** One process owns one SQLite file (`instances: 1`). Every write (upsert, delete, clear, remove-index)
runs inside a `BEGIN IMMEDIATE` transaction, so two processes sharing one file would have correct,
serialized writes — there's no read-then-write race like `shortlink`'s redirect path. What would not
be consistent is metrics: every "searches" number this service reports (`/metrics`, `/v1/stats`,
per-index counts) comes from one process-local counter with no durable backing at all, so it resets
on restart and would split unreconciled across two instances. See
[docs/READINESS.md](docs/READINESS.md) for the full contract.

## Observability

Requests are logged with `reqId` (accepts or generates `X-Request-Id`; no `traceparent` support —
implemented in gateway and console so far). `/health` is a static check; `/ready` pings the database, cached for 10s.
Unlike `ratelimit`, there is no durable table backing search-query counts — `search_queries_total`
and `searchesSinceStart` are the same in-memory counter everywhere they appear. See
[docs/READINESS.md](docs/READINESS.md) for the full contract.

## Backup / restore

The state to protect is the SQLite file at `DB_PATH` (default `./data/search.db`, plus WAL sidecars
while running) — the FTS5 full-text index lives inside the same file as ordinary shadow tables, so a
plain file copy captures everything with no separate re-indexing step. Use `stack backup`/
`stack restore` from the workspace root (see `stack/docs/UPGRADE.md`) to snapshot and restore this
consistently alongside the rest of the stack. On every start, before applying a pending migration
to an existing database, the service itself also snapshots the file to
`DB_PATH.pre-v<N>-<timestamp>` (directory overridable with `DB_BACKUP_DIR`) — a manual last resort
if `stack restore` is unavailable.

**Rollback limitations:** none of the migrations are reversible; to roll back, restore the
pre-migration copy (or a `stack backup` snapshot taken before the upgrade) and run the previous
version of this service against it.

See [docs/READINESS.md](docs/READINESS.md) for the full contract.

## License

MIT, see [LICENSE](LICENSE).
