import { Config } from '../src/config.js';
import { Database } from '../src/db.js';
import { SearchService } from '../src/domain/search-service.js';
import { SearchApi } from '../src/http/search-api.js';
import { DocumentStore } from '../src/store/document-store.js';
import { IndexStore } from '../src/store/index-store.js';

export const RW_KEY = 'k'.repeat(40);
export const READ_KEY = 'r'.repeat(40);
export const WRITE_KEY = 'w'.repeat(40);
export const SHOP_KEY = 'p'.repeat(40);

/** @param {Record<string, string>} [overrides] */
export function testEnv(overrides = {}) {
  return {
    PORT: '0',
    SEARCH_API_KEYS: `console:${RW_KEY},site:${READ_KEY}:read,indexer:${WRITE_KEY}:write,shop:${SHOP_KEY}:readwrite:products+docs`,
    DB_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    MAX_BATCH: '5',
    ...overrides,
  };
}

/** @param {Record<string, string>} [overrides] */
export function testConfig(overrides) {
  return Config.fromEnv(testEnv(overrides));
}

/** Wired domain objects over an in-memory database. @param {Record<string, string>} [overrides] */
export function testService(overrides) {
  const config = testConfig(overrides);
  let t = Date.parse('2026-09-17T10:00:00Z');
  const db = new Database(':memory:');
  const indexes = new IndexStore(db);
  const documents = new DocumentStore(db);
  const service = new SearchService({ db, indexes, documents, options: config, now: () => (t += 1000) });
  return { config, db, indexes, documents, service };
}

/** Fully wired Fastify app. @param {Record<string, string>} [overrides] @param {object} [deps] Extra constructor deps, e.g. an AuditClient. */
export async function buildApp(overrides, deps = {}) {
  const t = testService(overrides);
  const app = await new SearchApi({ version: '0.0.0-test', ...t, ...deps, logger: /** @type {any} */ ({ info() {}, warn() {}, error() {}, fatal() {}, debug() {}, trace() {}, child() { return this; } }) }).build();
  await app.ready();
  return { app, ...t };
}

/** @param {string} key */
export function bearer(key) {
  return { authorization: `Bearer ${key}` };
}

/** A small product catalogue with Turkish text, tags and attributes. @type {import("../src/types.js").DocumentInput[]} */
export const PRODUCTS = [
  { id: 'p1', title: 'Kırmızı Yazlık Elbise', body: 'Pamuklu, hafif ve rahat. Yaz akşamları için ideal.', tags: ['elbise', 'yaz'], attrs: { color: 'red', brand: 'Mavi', price: 499, sizes: ['S', 'M', 'L'], inStock: true }, url: 'https://shop.example/p1' },
  { id: 'p2', title: 'Mavi Kot Pantolon', body: 'Slim fit, yüksek bel. Günlük kullanım için.', tags: ['pantolon'], attrs: { color: 'blue', brand: 'Mavi', price: 899, sizes: ['M', 'L'], inStock: true } },
  { id: 'p3', title: 'Siyah Deri Ceket', body: 'Gerçek deri, kırmızı astarlı. Kış için sıcak tutar.', tags: ['ceket', 'kış'], attrs: { color: 'black', brand: 'Koton', price: 2499, sizes: ['L'], inStock: false } },
  { id: 'p4', title: 'Elbise Askısı (10 adet)', body: 'Ahşap, kırılmaz.', tags: ['aksesuar'], attrs: { color: 'brown', brand: 'IKEA', price: 79, inStock: true } },
];
