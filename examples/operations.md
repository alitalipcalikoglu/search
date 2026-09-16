# Operations

## Probes

```bash
curl -s $SEARCH/health   # {"status":"ok"}
curl -s $SEARCH/ready    # {"status":"ok"} when SQLite answers; 503 otherwise (cached 10 s)
```

## Metrics

```bash
scurl $SEARCH/metrics
```

```
search_indexes 3
search_documents{index="products"} 48210
search_documents_total 61300
search_queries_total{index="products"} 18320
search_db_bytes 187432960
search_process_uptime_seconds 86400
```

## Environment

Required: `SEARCH_API_KEYS`. Full list with defaults: [.env.example](../.env.example). `BODY_LIMIT` must hold a whole indexing batch (`MAX_BATCH × MAX_DOC_BYTES` at worst; the default 8 MiB fits 500 documents of 16 KiB).

## Process manager

```bash
cp .env.example .env && $EDITOR .env
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
pm2 reload search
```

## Docker

```bash
docker build -t atc-search .
docker run -d -p 3010:3010 -v search-data:/data --env-file .env atc-search
```

## Backups and reindexing

```bash
sqlite3 data/search.db ".backup 'search-$(date +%F).db'"
```

The database is derived data: every document came from one of your systems. A backup saves a reindex; losing it costs one full pass of upserts. Reindex after changing how you build documents (new attributes, different body text); weights and facets need no reindex.

## Size

Documents, the folded full-text index and the attribute rows each take space: expect roughly 2–3× the raw text. Hundreds of thousands of documents are comfortable on one instance; split by index across instances beyond that. `search_db_bytes` shows growth; SQLite reclaims space only with `VACUUM` (run it offline after a large clear).
