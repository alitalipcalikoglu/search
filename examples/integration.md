# Site search integration

Browsers never call the search service directly: the key would leak and the index would be enumerable. Put a thin endpoint in your backend (or a [gateway](https://github.com/alitalipcalikoglu/gateway) route with `injectApiKey`) and give that backend a **read** key scoped to the index.

## Backend endpoint (Fastify)

```js
app.get('/api/search', async (req, reply) => {
  const { q = '', page = '1', brand, color } = req.query;
  const limit = 20;
  const res = await fetch(`${process.env.SEARCH_URL}/v1/indexes/products/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SEARCH_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ q, limit, offset: (Number(page) - 1) * limit, highlight: true, facets: ['brand', 'color'], filters: { ...(brand ? { brand: [brand] } : {}), ...(color ? { color: [color] } : {}) } }),
    signal: AbortSignal.timeout(3_000),
  });
  if (!res.ok) return reply.code(503).send({ error: 'search unavailable' });
  const r = await res.json();
  return { total: r.total, page: Number(page), hits: r.hits.map((h) => ({ id: h.id, title: h.highlights.title, snippet: h.highlights.body, url: h.url })), facets: r.facets };
});
```

Map the response to what the page needs (never forward `attrs` you do not want public), keep the timeout short and answer 503 rather than hanging.

## Client

```js
export class SearchBox {
  constructor(input, render) { this.input = input; this.render = render; this.timer = 0; this.ctrl = null; input.addEventListener('input', () => this.schedule()); }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 200); }
  async run() {
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    const q = this.input.value.trim();
    if (!q) return this.render({ hits: [], total: 0 });
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: this.ctrl.signal });
      if (res.ok) this.render(await res.json());
      else this.render({ error: true });
    } catch (err) { if (err.name !== 'AbortError') this.render({ error: true }); }
  }
}
```

Debounce, abort the previous request when a new one starts, and render an error state instead of stale results.

## Keeping it fast

- Ask for `highlight` and `facets` only on the results page, not for the type-ahead.
- Cache popular queries for a few seconds in the backend if the index changes rarely.
- Watch `search_queries_total` and the service's request latency in its logs; SQLite FTS5 answers typical catalogue queries in single-digit milliseconds up to a few hundred thousand documents.
