import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SearchError } from '../src/domain/errors.js';
import { PRODUCTS, testService } from './helpers.js';

test('SearchService: indexes, batch upsert (all or nothing), documents, clear, delete', () => {
  const { service: s, indexes, documents } = testService();
  const idx = s.createIndex({ name: 'products', description: 'Shop catalogue', weights: { title: 8 }, facets: ['color', 'brand', 'tags'] }, 'console');
  assert.deepEqual(JSON.parse(idx.weights), { title: 8, body: 1, tags: 3 });
  assert.throws(() => s.createIndex({ name: 'products' }, 'console'), (e) => e instanceof SearchError && e.code === 'INDEX_EXISTS');
  assert.throws(() => s.createIndex({ name: 'x', facets: ['bad key!'] }, 'console'), (e) => e instanceof SearchError && e.code === 'INVALID_QUERY');
  assert.throws(() => s.createIndex({ name: 'x', weights: { body: 500 } }, 'console'), (e) => e instanceof SearchError && e.code === 'INVALID_QUERY');
  assert.deepEqual(s.upsert('products', PRODUCTS, 'indexer'), { created: 4, updated: 0 });
  assert.deepEqual(s.upsert('products', [{ ...PRODUCTS[0], title: 'Kırmızı Yazlık Elbise (yeni)' }], 'indexer'), { created: 0, updated: 1 });
  assert.equal(s.getDocument('products', 'p1').title, 'Kırmızı Yazlık Elbise (yeni)');
  assert.deepEqual(indexes.counts().get('products')?.documents, 4);
  // A bad document in the batch rejects the whole batch.
  assert.throws(() => s.upsert('products', [{ id: 'p9', title: 'ok' }, { id: 'p10', title: '' }], 'indexer'), (e) => e instanceof SearchError && e.code === 'INVALID_DOCUMENT' && /documents\[1\]\.title/.test(e.message));
  assert.equal(documents.get('products', 'p9'), undefined, 'nothing landed');
  assert.throws(() => s.upsert('products', [{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }], 'indexer'), /duplicate ids/);
  assert.throws(() => s.upsert('products', Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, title: 'x' })), 'indexer'), (e) => e instanceof SearchError && e.code === 'BATCH_TOO_LARGE');
  assert.throws(() => s.upsert('products', [{ id: 'big', title: 'x', body: 'y'.repeat(70_000) }], 'indexer'), (e) => e instanceof SearchError && e.code === 'DOCUMENT_TOO_LARGE');
  assert.throws(() => s.upsert('products', [{ id: 'a', title: 'x', attrs: { tags: 'nope' } }], 'indexer'), /attrs key "tags"/);
  assert.throws(() => s.upsert('products', [{ id: 'a', title: 'x', attrs: { nested: /** @type {any} */ ({ a: 1 }) } }], 'indexer'), /must be a string, number, boolean/);
  assert.throws(() => s.upsert('nope', [{ id: 'a', title: 'x' }], 'indexer'), (e) => e instanceof SearchError && e.code === 'INDEX_NOT_FOUND');
  s.removeDocument('products', 'p4');
  assert.throws(() => s.getDocument('products', 'p4'), (e) => e instanceof SearchError && e.code === 'DOCUMENT_NOT_FOUND');
  assert.equal(s.search('products', { q: 'askı' }).total, 0, 'full-text row removed with the document');
  s.updateIndex('products', { description: 'd2', weights: { body: 2 }, facets: ['brand'] });
  assert.deepEqual([JSON.parse(s.getIndex('products').weights), JSON.parse(s.getIndex('products').facets)], [{ title: 8, body: 2, tags: 3 }, ['brand']]);
  assert.equal(s.clearIndex('products'), 3);
  assert.equal(s.search('products', { q: '' }).total, 0);
  s.upsert('products', PRODUCTS.slice(0, 2), 'indexer');
  s.removeIndex('products');
  assert.throws(() => s.getIndex('products'), (e) => e instanceof SearchError && e.code === 'INDEX_NOT_FOUND');
  assert.equal(documents.total(), 0, 'documents go with the index');
});

test('SearchService: ranking, Turkish folding, prefix, phrases, exclusion, highlights', () => {
  const { service: s } = testService();
  s.createIndex({ name: 'products' }, 'console');
  s.upsert('products', PRODUCTS, 'indexer');
  let r = s.search('products', { q: 'kirmizi', highlight: true });
  assert.deepEqual(r.hits.map((h) => h.id), ['p1', 'p3'], 'title hit ranks above body hit');
  assert.equal(r.total, 2);
  assert.equal(r.hits[0].highlights?.title, '<mark>Kırmızı</mark> Yazlık Elbise');
  assert.match(String(r.hits[1].highlights?.body), /<mark>kırmızı<\/mark> astarlı/);
  assert.ok(typeof r.hits[0].score === 'number' && r.hits[0].score > (r.hits[1].score ?? 0));
  assert.deepEqual(s.search('products', { q: 'elb' }).hits.map((h) => h.id), ['p1', 'p4'], 'prefix on the last term');
  assert.deepEqual(s.search('products', { q: '"kot pantolon"' }).hits.map((h) => h.id), ['p2']);
  assert.deepEqual(s.search('products', { q: 'elbise -askısı' }).hits.map((h) => h.id), ['p1']);
  assert.deepEqual(s.search('products', { q: 'İSTANBUL' }).hits, []);
  assert.deepEqual(s.search('products', { q: 'yaz' }).hits.map((h) => h.id), ['p1'], 'tags are searchable');
  assert.equal(s.search('products', { q: 'a OR b) AND (' }).total, 0, 'FTS syntax in input is harmless');
  assert.deepEqual(s.search('products', { q: '', sort: 'newest' }).hits.map((h) => h.id), ['p4', 'p3', 'p2', 'p1'], 'browse newest first');
  assert.deepEqual(s.search('products', { q: '', sort: 'oldest', limit: 2, offset: 1 }).hits.map((h) => h.id), ['p2', 'p3']);
  assert.throws(() => s.search('products', { q: 'x', offset: 20_000 }), (e) => e instanceof SearchError && e.code === 'INVALID_QUERY');
  assert.equal(s.searches.get('products'), 9, 'the rejected search is not counted');
});

test('SearchService: filters (AND across keys, OR within), facets over the matched set, suggestions', () => {
  const { service: s } = testService();
  s.createIndex({ name: 'products', facets: ['color', 'brand'] }, 'console');
  s.upsert('products', PRODUCTS, 'indexer');
  assert.deepEqual(s.search('products', { q: '', filters: { brand: ['Mavi'] } }).hits.map((h) => h.id).sort(), ['p1', 'p2']);
  assert.deepEqual(s.search('products', { q: '', filters: { brand: ['Mavi'], color: ['blue'] } }).hits.map((h) => h.id), ['p2'], 'AND across keys');
  assert.deepEqual(s.search('products', { q: '', filters: { color: ['blue', 'black'] } }).hits.map((h) => h.id).sort(), ['p2', 'p3'], 'OR within a key');
  assert.deepEqual(s.search('products', { q: '', filters: { sizes: ['M'] } }).hits.map((h) => h.id).sort(), ['p1', 'p2'], 'array attributes filter per element');
  assert.deepEqual(s.search('products', { q: '', filters: { inStock: ['true'] } }).total, 3, 'booleans and numbers filter as strings');
  assert.deepEqual(s.search('products', { q: '', filters: { tags: ['kış'] } }).hits.map((h) => h.id), ['p3']);
  const r = s.search('products', { q: 'elbise', facets: ['brand', 'color', 'tags'] });
  assert.deepEqual(r.facets, { brand: [{ value: 'IKEA', count: 1 }, { value: 'Mavi', count: 1 }], color: [{ value: 'brown', count: 1 }, { value: 'red', count: 1 }], tags: [{ value: 'aksesuar', count: 1 }, { value: 'elbise', count: 1 }, { value: 'yaz', count: 1 }] }, 'facets count the matched set only');
  assert.deepEqual(s.search('products', { q: '', facets: ['brand'], filters: { inStock: ['true'] } }).facets.brand, [{ value: 'Mavi', count: 2 }, { value: 'IKEA', count: 1 }]);
  assert.throws(() => s.search('products', { q: '', filters: { 'bad key': ['x'] } }), (e) => e instanceof SearchError && e.code === 'INVALID_QUERY');
  assert.deepEqual(s.suggest('products', 'elb').map((x) => x.id).sort(), ['p1', 'p4']);
  assert.deepEqual(s.suggest('products', 'Kırm').map((x) => x.title), ['Kırmızı Yazlık Elbise']);
  assert.deepEqual(s.suggest('products', 'astar'), [], 'suggestions look at titles only');
  assert.deepEqual(s.suggest('products', '   '), []);
});
