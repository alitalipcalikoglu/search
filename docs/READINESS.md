# `search` readiness contract

## Purpose
`search` lets the rest of the platform add full-text search over its own data without running a
separate search engine: named indexes with per-field ranking weights, batch-upserted documents,
BM25-ranked queries with attribute filters and facet counts, HTML-safe highlighted results, and
type-ahead suggestions — all on SQLite FTS5, with case/diacritic/Turkish-dotted-i folding so
`kirmizi` finds `Kırmızı`.

## Dependencies
- `audit` (`AUDIT_URL` + `AUDIT_API_KEY`): optional, both-or-neither. Same mechanism as `flags`,
  `shortlink` and `ratelimit` — `src/net/audit-client.js` is byte-identical across all four
  (verified with `diff`). Unset: writes still succeed. Set: write events (index create/update/
  delete/clear, document delete) are buffered in memory and flushed on a background 2s timer, never
  on the request path. Buffered-and-unflushed events are lost on an ungraceful restart.

No other service or external system is called by `search`.

## Durability classes (Stage 10)
Three, verified against the code (`src/`), not assumed:
- **Authoritative, durable**: `indexes`, `documents`, `documents_fts`, `document_attrs` — SQLite,
  `DB_PATH`. This service is the only copy of the indexed content there is; there is no separate
  "primary" store elsewhere that `search` re-indexes from, and no code path here that rebuilds this
  data from anything else. Losing this file loses the index for good, exactly like any of this
  platform's other stateful services losing their database — not a cache, not regenerable. See
  "Persistence"/"Backup"/"Restore" below.
- **Rebuildable state**: none exists in this service. There is no derived cache, no materialized
  view, no secondary index that could be dropped and regenerated from the authoritative tables above
  — `documents_fts` is written directly, in the same transaction as `documents` (see "Persistence"),
  not maintained by a separate rebuildable job.
- **Ephemeral, process-local, non-durable**: `SearchService.searches` (a plain in-memory `Map`) is
  the *sole* source — durable or not — of every "how many searches happened" number this service
  reports (`GET /metrics`'s `search_queries_total`, `GET /v1/stats`'s `searchesSinceStart`, each
  index's `searchesSinceStart` in `GET /v1/indexes`). It resets to `0` on every restart with **no
  durable fallback to reconcile against** — unlike, say, `ratelimit`'s durable `decisions` table
  alongside its own process-local tally, `search` has only the one, non-durable number. See
  "Metrics" below for the full comparison.

**Restart behavior**: the authoritative tables above survive a restart unchanged (ordinary SQLite
durability, WAL + `synchronous = NORMAL`); `SearchService.searches` does not — it starts back at
`{}` every time, silently, with nothing logged or exposed to say so.

**Backup expectations**: back up `DB_PATH` (plus its WAL/SHM sidecars while running) — that alone is
the complete, sufficient backup, since the FTS5 index lives inside the same file (see "Backup"
below) and there is nothing rebuildable or ephemeral worth preserving separately (ephemeral counts
are, by definition, not worth backing up — they are expected to reset).

## Persistence
Engine: SQLite via `node:sqlite`'s `DatabaseSync` (`src/db.js`), WAL journal mode, `synchronous =
NORMAL`, `busy_timeout = 5000`, foreign keys on. File location: `DB_PATH`, default
`./data/search.db` (Docker: `/data/search.db`).

Schema (one migration block, `Database.MIGRATIONS[0]`):
- `indexes` — one row per named index: `name` (PK), `description`, `weights` (JSON, per-field BM25
  weights), `facets` (JSON array of facetable attribute keys), `created_by`, `created_at`,
  `updated_at`.
- `documents` — one row per document: `rowid` (autoincrement PK, also the FTS5 join key),
  `index_name` (FK, `ON DELETE CASCADE`), `id` (caller-chosen), `title`, `body`, `tags` (JSON),
  `attrs` (JSON), `url`, `source`, `created_at`, `updated_at`; `UNIQUE (index_name, id)`; index
  `documents_index_updated(index_name, updated_at DESC, rowid DESC)`.
- `documents_fts` — an FTS5 virtual table (`tokenize='unicode61'`) over **folded** copies of
  `title`, `body`, `tags`, keyed by the same `rowid` as `documents`. There are no triggers — the
  application writes both tables together in `DocumentStore.upsert`/`delete`/`clear`, so a caller
  going around `DocumentStore` (there is none in this codebase, but worth stating) could desync them.
- `document_attrs` — one row per scalar attribute value (array elements and tags flattened in):
  `doc_rowid` (FK, `ON DELETE CASCADE`), `index_name`, `key`, `value`; indexes
  `document_attrs_lookup(index_name, key, value, doc_rowid)` (filters/facets) and
  `document_attrs_doc(doc_rowid)` (cleanup on delete).

Migration mechanism: identical pattern to the other three services — `Database.MIGRATIONS` array
gated by `PRAGMA user_version`, one transaction per block. Fresh install and "upgrade from nothing"
behave the same today (one migration). No down-migration mechanism.

**No retention or cleanup job exists in this service** — unlike `flags` (`Maintenance`, hourly
history purge), `shortlink` (`Maintenance`, hourly click purge) and `ratelimit` (`CleanupWorker`,
counters/overrides/decisions purge), `search` has no `maintenance.js` or `worker.js` at all (checked:
neither file exists, and `Application` in `src/application.js` starts nothing periodic beyond the
HTTP server itself). Every document indexed stays until explicitly deleted or its index is cleared/
removed — there is no automatic size or age-based eviction.

## Health endpoint
`GET /health` returns `{ status: 'ok' }` unconditionally, no I/O, cannot be slow or fail while the
process event loop is otherwise alive. Logged at `warn`.

## Readiness endpoint
`GET /ready` calls `this.db.ping()` (`SELECT 1`), cached for `SearchApi.READY_CACHE_MS = 10_000`ms —
identical mechanism to the other three services. Read-only, no mutation, no discarded work, safe to
poll at any interval.

## Graceful shutdown
`SIGTERM`/`SIGINT` → `Application.shutdown(reason)` (idempotent guard). Order: `await
this.app.close()` (drain in-flight requests) → `await this.audit.close()` (stop timer, final flush)
→ `this.db.close()` — **one step shorter than `flags`/`shortlink`/`ratelimit`**, since there is no
maintenance worker to stop first. A `30_000`ms unref'd force-exit timer runs in parallel.
`unhandledRejection` routes through the same graceful path; `uncaughtException` calls
`process.exit(1)` immediately, skipping drain and final audit flush. PM2 `kill_timeout: 35000`ms —
same numbers and comment as the other three services.

## Resource limits
- `BODY_LIMIT` (env, default `8_388_608` bytes = 8 MiB — much larger than the other services',
  because a single bulk-upsert request can carry up to `MAX_BATCH` documents of up to
  `MAX_DOC_BYTES` each).
- `MAX_BATCH` (env, default `500`, range 1–10,000) — documents per `PUT .../documents` call; the
  whole batch is validated and applied in one transaction, so a batch that fails validation applies
  nothing.
- `MAX_DOC_BYTES` (env, default `65_536`) — JSON-encoded size cap per document.
- `MAX_ATTRS` (env, default `50`, range 1–500) — flattened attribute-value rows per document (tags
  count toward this too).
- `MAX_PAGE` (env, default `100`, range 1–1,000) — largest `limit` a search/browse call may request
  (`Math.min(q.limit ?? 20, maxPage)`, silently clamped rather than rejected).
- `MAX_OFFSET` (env, default `10_000`) — deepest `offset`; exceeding it is a hard `400
  INVALID_QUERY`, not a clamp.
- `MAX_FACET_VALUES` (env, default `20`, range 1–200) — values returned per requested facet.
- `RATE_LIMIT_MAX` (env, default `1_200`) requests per API key per minute.
- `max_memory_restart: '300M'` in `ecosystem.config.cjs`.

## Timeouts
- Audit outbound call: `timeoutMs = 5_000` default, unchanged by `Application`.
- Shutdown force-exit: `30_000`ms, hard-coded.
- PM2 `listen_timeout: 10000`ms.
- No outward per-request timeout beyond the audit client's — `search` never calls another service
  synchronously; every operation is a local SQLite query or transaction, including FTS5 matching.

## Retry policy
Only the audit forwarding path retries, off the request path, on a background timer — same numbers
as the other three services (byte-identical `AuditClient`): `MAX_ATTEMPTS = 6`, backoff `min(30_000,
500 * 2 ** attempt)`ms, no jitter; non-429 4xx drops the batch permanently; 429/5xx/network
error/timeout keeps it buffered for the next `flushMs = 2_000`ms tick. Nothing else in this service
retries — a failed batch upsert or search returns an error to the caller with no internal retry.

## Idempotency
- `POST /v1/indexes` (create) is **not** idempotent: repeating with the same `name` fails `409
  INDEX_EXISTS`.
- `PATCH /v1/indexes/:name` is idempotent in result for a fixed patch.
- `DELETE /v1/indexes/:name` is **not** safe to repeat: `removeIndex` calls `this.indexes.require(name)`
  first, throwing `404 INDEX_NOT_FOUND` once the index is gone.
- `POST /v1/indexes/:name/clear` **is** safe to repeat: `documents.clear()` is a `DELETE FROM
  documents WHERE index_name = ?` (plus matching FTS row deletes), and repeating it after the index
  is already empty just deletes zero rows (`removed: 0`).
- **`PUT /v1/indexes/:name/documents` (upsert) is naturally idempotent per document**: `DocumentStore.upsert`
  keys on `(index_name, id)` — the same document body submitted twice produces the same end state
  (the second call reports it as `updated`, not `created`, and overwrites with identical values).
  This is true idempotence via natural key, not an idempotency-key mechanism.
- `DELETE .../documents/:id` is **not** safe to repeat: `removeDocument` throws `404
  DOCUMENT_NOT_FOUND` on the second call.
- `GET`/`POST` search, suggest, browse, and `/v1/stats` are naturally idempotent — read-only.

## Backup
State that must survive a disk loss: the SQLite file at `DB_PATH` (default `./data/search.db`) plus
WAL/SHM sidecars while running — this includes the FTS5 virtual table's own shadow tables
(`documents_fts_data`, `_idx`, `_content`, etc., created automatically by SQLite inside the same
file), so a plain file copy captures the full-text index along with the row data; there is nothing
to separately rebuild. No backup script exists in this repository; capture today via a
stopped-process file copy or SQLite's own online-backup mechanism (not wired up here).

## Restore
Stop the service, replace `DB_PATH` (and stale `-wal`/`-shm` files) with the backup, start —
`#migrate()` applies any newer migrations automatically, and the FTS5 index restores along with the
rest of the file (no separate re-indexing step is needed, since `documents_fts` is part of the same
database file, not an external index). No ordering constraint with other services' data: index names
and document ids are caller-chosen opaque strings, not foreign keys into another service's database.

## Metrics
`GET /metrics` (Prometheus text, `read`-role key required):
- `search_indexes` — durable, count of rows in `indexes`.
- `search_documents{index}` — durable, from `IndexStore.counts()` (`GROUP BY index_name` on
  `documents`).
- `search_documents_total` — durable, `DocumentStore.total()`.
- `search_queries_total{index}` — **process-local**: read from `SearchService.searches`, an
  in-memory `Map` incremented on every `search()` call; resets to 0 on every restart.
- `search_db_bytes` — durable, `Database.sizeBytes()`.
- `search_process_uptime_seconds` — process-local, resets on restart.

**Important distinction from `ratelimit`**: `ratelimit` has *two* numbers for "how much activity
happened" — a durable `decisions` table (used by `/v1/stats`/`/v1/policies/:name/stats`) and a
separate process-local tally (used only by `/metrics`), so the two can be cross-checked and the
durable one survives a restart. `search` has **no durable equivalent for search-query counts at
all**: `GET /v1/stats`'s `searchesSinceStart` field and every index's `searchesSinceStart` in
`GET /v1/indexes` read the exact same process-local `SearchService.searches` Map that backs
`search_queries_total` in `/metrics` — there is only one number, it is process-local everywhere it
appears, and it resets to zero on every restart with no durable record to fall back on. Document
counts (`search_documents`, `search_documents_total`) and index counts, by contrast, are always
durable database reads.

## Logging
Same as the other three services: Fastify default request logger, `requestIdHeader: 'x-request-id'`,
`genReqId: randomUUID`, `reqId` on every log line per
[OBSERVABILITY.md](../../stack/docs/OBSERVABILITY.md), `req.headers.authorization` redacted. Not
emitted: `traceId`, `spanId`, `route`/`op`, `durationMs` (Fastify's `responseTime` field, different
name), `upstream`/`upstreamMs` (no proxied calls), `service`, `version`. `code` is in every JSON
error body but only additionally logged for 500s via `request.log.error({ err }, 'unhandled error')`.

## Tracing
Accepts whatever `X-Request-Id` the caller sends (no trust gate — internal service reached only via
gateway, console or peers) and generates one when absent. Does **not** parse, forward, or log
`traceparent` — implemented in `gateway` and `console` (Stage 10). No outbound calls happen
in the request path, so there is nothing to propagate onward regardless.

## Security model
Bearer API keys (`SEARCH_API_KEYS=id:secret[:role[:indexes]]`), compared via SHA-256 +
`timingSafeEqual` (same `ApiKeyAuth` pattern as the other three services). Roles: `read`, `write`,
`readwrite` (default) — no `check`-only role (unlike `ratelimit`), since a search read is not a
quota-spending action that needs its own narrower role. Index scoping: a key's `indexes` list (or
`null` for all) is enforced on every route naming an index, including hiding scoped-out indexes from
listings and `/v1/stats`. No secret rotation support: edit `SEARCH_API_KEYS` and restart. At the
boundary: request bodies are schema-validated with the same custom JSON content-type parser as
`ratelimit` (clean `400 INVALID_JSON` on malformed bodies instead of Fastify's default); user search
queries are tokenized and quoted by `QueryParser` before reaching FTS5, so no MATCH operator, column
filter or wildcard from user input runs as FTS5 query syntax; highlighted output is HTML-escaped with
only `<mark>` tags as markup. Out of scope: per-document permissions (the README states this
explicitly — use one index per audience, or filter by a trusted `audience` attribute), authenticating
whoever a document's `source` field claims to be (it's whatever the writing API key's id is, trusted
by construction).

## Scaling model
**B — single-node stateful**: one process owns one SQLite file, `instances: 1` pinned in
`ecosystem.config.cjs` ("one process per SQLite file"), and the README's own "Out of scope" section
already says so ("Cluster / replication: one process per database file; split indexes across
instances to scale").

Every write path (`upsert`, `removeDocument`, `removeIndex`, `clearIndex`) is wrapped in
`this.db.transaction()` (`BEGIN IMMEDIATE` … `COMMIT`), so two processes sharing one file would have
their writes serialized correctly by SQLite's own locking, the same way `ratelimit`'s check/consume
path is — there is no read-then-write-outside-a-transaction pattern in this service comparable to
`shortlink`'s `maxClicks` issue. What would **not** be consistent across two processes is entirely
process-local state: `SearchService.searches` (the sole source, durable or not, of every
"searches"/"queries" number this service reports, as detailed under Metrics) and each instance's own
10s readiness cache would diverge — one instance could report zero searches for an index the other
instance has been serving heavily.

## Single-node / multi-node guarantees
Running two `search` instances against the same `DB_PATH` is not a topology this repository ships or
tests. Document and index data would stay correct (transactional writes, SQLite's own locking) —
there is no known correctness bug comparable to `shortlink`'s `maxClicks` race. The guarantee that
does **not** hold: search-count metrics (`search_queries_total`, `/v1/stats`'s
`searchesSinceStart`, `/v1/indexes`' per-index `searchesSinceStart`) are entirely process-local with
no durable backing at all, so with two instances behind a load balancer, neither instance's reported
count would reflect total traffic, and restarting either one silently zeroes its share with nothing
to reconcile against.

## Known failure modes
- **Disk full**: a write inside `db.transaction()` (upsert, delete, clear, remove-index) throws,
  rolls back, and the request fails `500`; because `documents` and `documents_fts` are written
  together inside the same transaction, a rollback cannot leave the two out of sync.
- **Audit service times out or is unreachable mid-request**: no effect on the search request —
  `record()` is a synchronous in-memory push; network I/O is deferred to the background timer. Long
  enough downtime drops events once `MAX_BUFFER = 5_000` is hit.
- **Process killed without graceful shutdown**: buffered-but-unflushed audit events are lost; the
  SQLite file (including the FTS5 shadow tables) should stay consistent (WAL, atomic commits), but
  the in-flight request being served at the moment of the kill gets no response.
- **Two instances run against one file**: unsupported configuration; document/index data would stay
  correct, but every "searches" metric this service exposes is process-local with no durable
  fallback (see Metrics above), so operators would see an incomplete and non-reconcilable picture of
  query volume split across instances.
- **Unbounded growth**: since there is no retention/cleanup job in this service at all (unlike the
  other three), a caller that keeps indexing without ever deleting or clearing stale documents will
  grow the SQLite file (and its FTS5 shadow tables) indefinitely — there is no built-in backstop; the
  operator must manage document lifecycle from the calling application or via `POST
  .../indexes/:name/clear` / `DELETE .../documents/:id` themselves.
