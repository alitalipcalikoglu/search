import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTS, READ_KEY, RW_KEY, SHOP_KEY, WRITE_KEY, bearer, buildApp } from './helpers.js';

const json = (/** @type {import('light-my-request').Response} */ r) => JSON.parse(r.body);

test('API: probes, auth, roles and index scoping', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/ready' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/indexes' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/indexes', headers: bearer(WRITE_KEY) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(READ_KEY), payload: { name: 'a' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(WRITE_KEY), payload: { name: 'products' } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(WRITE_KEY), payload: { name: 'internal' } })).statusCode, 201);
  let res = await app.inject({ url: '/v1/indexes', headers: bearer(SHOP_KEY) });
  assert.deepEqual(json(res).items.map((/** @type {any} */ i) => i.name), ['products'], 'scoped key sees only its indexes');
  res = await app.inject({ url: '/v1/indexes/internal/search?q=x', headers: bearer(SHOP_KEY) });
  assert.equal(res.statusCode, 403);
  assert.match(json(res).error.message, /no access to index "internal"/);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(SHOP_KEY), payload: { name: 'other' } })).statusCode, 403, 'scoped key cannot create outside its scope');
  assert.equal((await app.inject({ url: '/metrics', headers: bearer(WRITE_KEY) })).statusCode, 403);
});

test('API: index lifecycle, bulk indexing, documents, search GET and POST, facets, suggest, stats, metrics', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  let res = await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(WRITE_KEY), payload: { name: 'products', description: 'Catalogue', weights: { title: 8 }, facets: ['color', 'brand', 'tags'] } });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.headers.location, '/v1/indexes/products');
  assert.deepEqual([json(res).index.documents, json(res).index.weights, json(res).index.createdBy], [0, { title: 8, body: 1, tags: 3 }, 'indexer']);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(WRITE_KEY), payload: { name: 'Bad Name' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes', headers: bearer(WRITE_KEY), payload: { name: 'products' } })).statusCode, 409);

  res = await app.inject({ method: 'PUT', url: '/v1/indexes/products/documents', headers: bearer(WRITE_KEY), payload: { documents: PRODUCTS } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(json(res), { created: 4, updated: 0 });
  res = await app.inject({ method: 'PUT', url: '/v1/indexes/products/documents', headers: bearer(WRITE_KEY), payload: { documents: [{ id: 'p9', title: 'x', extra: 1 }] } });
  assert.equal(res.statusCode, 400, 'unknown document field');
  res = await app.inject({ method: 'PUT', url: '/v1/indexes/products/documents', headers: bearer(WRITE_KEY), payload: { documents: [{ id: 'p9', title: ' ' }] } });
  assert.equal(json(res).error.code, 'INVALID_DOCUMENT');
  assert.equal((await app.inject({ method: 'PUT', url: '/v1/indexes/products/documents', headers: bearer(READ_KEY), payload: { documents: PRODUCTS } })).statusCode, 403);

  res = await app.inject({ url: '/v1/indexes/products', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).index.documents, typeof json(res).index.lastIndexedAt], [4, 'string']);
  res = await app.inject({ url: '/v1/indexes/products/documents/p1', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).document.title, json(res).document.attrs.sizes, json(res).document.source], ['Kırmızı Yazlık Elbise', ['S', 'M', 'L'], 'indexer']);
  res = await app.inject({ url: '/v1/indexes/products/documents?limit=2&offset=1', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).total, json(res).items.map((/** @type {any} */ d) => d.id)], [4, ['p3', 'p2']]);

  res = await app.inject({ url: '/v1/indexes/products/search?q=k%C4%B1rm%C4%B1z%C4%B1&highlight=true&facets=color,brand&filter.inStock=true&limit=10', headers: bearer(READ_KEY) });
  assert.equal(res.statusCode, 200, res.body);
  let r = json(res);
  assert.deepEqual([r.total, r.hits.map((/** @type {any} */ h) => h.id), r.query], [1, ['p1'], '"kirmizi"*']);
  assert.equal(r.hits[0].highlights.title, '<mark>Kırmızı</mark> Yazlık Elbise');
  assert.deepEqual(r.facets, { color: [{ value: 'red', count: 1 }], brand: [{ value: 'Mavi', count: 1 }] });
  res = await app.inject({ method: 'POST', url: '/v1/indexes/products/search', headers: bearer(READ_KEY), payload: { q: '', filters: { color: ['blue', 'black'] }, facets: ['tags'], sort: 'oldest' } });
  r = json(res);
  assert.deepEqual([r.hits.map((/** @type {any} */ h) => h.id), r.facets.tags], [['p2', 'p3'], [{ value: 'ceket', count: 1 }, { value: 'kış', count: 1 }, { value: 'pantolon', count: 1 }]]);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/indexes/products/search', headers: bearer(READ_KEY), payload: { q: 'x', offset: 99_999 } })).statusCode, 400);
  assert.equal((await app.inject({ url: '/v1/indexes/products/search?q=' + 'x'.repeat(600), headers: bearer(READ_KEY) })).statusCode, 400);
  res = await app.inject({ url: '/v1/indexes/products/suggest?q=ma', headers: bearer(READ_KEY) });
  assert.deepEqual(json(res).items.map((/** @type {any} */ x) => x.id), ['p2']);

  res = await app.inject({ method: 'PATCH', url: '/v1/indexes/products', headers: bearer(WRITE_KEY), payload: { facets: ['brand'] } });
  assert.deepEqual(json(res).index.facets, ['brand']);
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/indexes/products/documents/p4', headers: bearer(WRITE_KEY) })).statusCode, 204);
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/indexes/products/documents/p4', headers: bearer(WRITE_KEY) })).statusCode, 404);
  res = await app.inject({ url: '/v1/stats', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).indexes, json(res).documents, json(res).searchesSinceStart, json(res).items[0].name], [1, 3, 3, 'products']);
  const metrics = await app.inject({ url: '/metrics', headers: bearer(READ_KEY) });
  assert.match(metrics.body, /search_documents\{index="products"\} 3\n/);
  assert.match(metrics.body, /search_queries_total\{index="products"\} 3\n/);
  assert.deepEqual(json(await app.inject({ method: 'POST', url: '/v1/indexes/products/clear', headers: { ...bearer(WRITE_KEY), 'content-type': 'application/json' } })), { removed: 3 });
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/indexes/products', headers: bearer(WRITE_KEY) })).statusCode, 204);
  assert.equal((await app.inject({ url: '/v1/indexes/products', headers: bearer(READ_KEY) })).statusCode, 404);
  assert.equal((await app.inject({ url: '/v1/indexes/products/search?q=a', headers: bearer(RW_KEY) })).statusCode, 404);
});
