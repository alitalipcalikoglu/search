import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { AuditClient } from '@atc-web/service-core/audit';
import { createErrorHandler, jsonParser, registerProbes } from '@atc-web/service-core/fastify';
import { SearchError } from '../domain/errors.js';
import { ApiKeyAuth } from './api-key-auth.js';
import { Schemas } from './schemas.js';
import { Views } from './views.js';

/** @typedef {import('../config.js').Config} Config */
/** @typedef {import('fastify').FastifyInstance} FastifyInstance */
/** @typedef {import('fastify').FastifyRequest} FastifyRequest */

/** HTTP surface: index management and indexing (write role), search and suggestions (read role). */
export class SearchApi {
  static READY_CACHE_MS = 10_000;

  /**
   * @param {object} deps
   * @param {Config} deps.config
   * @param {import('../domain/search-service.js').SearchService} deps.service
   * @param {import('../store/index-store.js').IndexStore} deps.indexes
   * @param {import('../store/document-store.js').DocumentStore} deps.documents
   * @param {import('../db.js').Database} deps.db
   * @param {import('../types.js').Logger} [deps.logger]
   * @param {import('@atc-web/service-core/audit').AuditClient} [deps.audit]
   */
  constructor({ config, audit, service, indexes, documents, db, logger }) {
    this.config = config;
    this.audit = audit;
    this.service = service;
    this.indexes = indexes;
    this.documents = documents;
    this.db = db;
    this.logger = logger;
    this.auth = new ApiKeyAuth(config.apiKeys);
  }

  /** @returns {Promise<FastifyInstance>} */
  async build() {
    const { config } = this;
    const app = Fastify({
      ...(config.tls ? { https: { cert: readFileSync(config.tls.certPath), key: readFileSync(config.tls.keyPath), minVersion: 'TLSv1.2' } } : {}),
      loggerInstance: this.logger,
      logger: this.logger ? undefined : { level: config.logLevel, redact: ['req.headers.authorization'] },
      trustProxy: config.trustProxy,
      bodyLimit: config.bodyLimit,
      requestIdHeader: 'x-request-id',
      genReqId: () => randomUUID(),
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    app.decorateRequest('apiKey', /** @type {any} */ (null));
    jsonParser(app);
    app.setErrorHandler(createErrorHandler(SearchError));
    app.addHook('onSend', AuditClient.hook(this.audit));
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } });
    });
    app.addHook('onSend', async (_request, reply) => {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cache-control', 'no-store');
    });
    registerProbes(app, () => this.db.ping(), { cacheMs: SearchApi.READY_CACHE_MS });
    await app.register((api) => this.#registerV1(api), { prefix: '/v1' });
    await app.register((ops) => this.#registerMetrics(ops));
    return app;
  }


  /** @param {FastifyInstance} api */
  async #registerV1(api) {
    api.addHook('onRequest', this.auth.hook);
    await api.register(rateLimit, {
      max: this.config.rateLimitMax,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.apiKey.id,
      errorResponseBuilder: (_request, context) => Object.assign(new Error(`rate limit exceeded, retry in ${context.after}`), { statusCode: 429, code: 'RATE_LIMITED' }),
    });
    const s = this.service;
    const read = { preValidation: ApiKeyAuth.require('read') };
    const write = { preValidation: ApiKeyAuth.require('write') };
    const name = (/** @type {FastifyRequest} */ r) => { const n = /** @type {{ name: string }} */ (r.params).name; ApiKeyAuth.assertIndex(r.apiKey, n); return n; };
    const docId = (/** @type {FastifyRequest} */ r) => /** @type {{ id: string }} */ (r.params).id;
    const query = (/** @type {FastifyRequest} */ r) => /** @type {Record<string, string|undefined>} */ (r.query);
    const visible = (/** @type {FastifyRequest} */ r) => { const scope = r.apiKey.indexes; return this.indexes.all().filter((i) => !scope || scope.includes(i.name)); };
    const view = (/** @type {import('../types.js').IndexRow} */ i, /** @type {Map<string, { documents: number, lastIndexedAt: number }>} */ counts) => Views.index(i, counts.get(i.name), s.searches.get(i.name));

    // ---- indexes
    api.post('/indexes', { config: { audit: AuditClient.route('search.index.create', (_r, b) => ({ type: 'index', id: b.index.name })) }, ...write, schema: { body: Schemas.createIndex } }, async (request, reply) => {
      const b = /** @type {{ name: string }} */ (request.body);
      ApiKeyAuth.assertIndex(request.apiKey, b.name);
      const row = s.createIndex(/** @type {any} */ (b), request.apiKey.id);
      reply.header('location', `/v1/indexes/${row.name}`);
      return reply.code(201).send({ index: view(row, this.indexes.counts()) });
    });
    api.get('/indexes', read, async (request) => { const counts = this.indexes.counts(); return { items: visible(request).map((i) => view(i, counts)) }; });
    api.get('/indexes/:name', { ...read, schema: { params: Schemas.nameParams } }, async (request) => ({ index: view(s.getIndex(name(request)), this.indexes.counts()) }));
    api.patch('/indexes/:name', { config: { audit: AuditClient.route('search.index.update', (r) => ({ type: 'index', id: /** @type {any} */ (r.params).name }), (r) => ({ patch: r.body })) }, ...write, schema: { params: Schemas.nameParams, body: Schemas.patchIndex } }, async (request) => ({ index: view(s.updateIndex(name(request), /** @type {any} */ (request.body)), this.indexes.counts()) }));
    api.delete('/indexes/:name', { config: { audit: AuditClient.route('search.index.delete', (r) => ({ type: 'index', id: /** @type {any} */ (r.params).name })) }, ...write, schema: { params: Schemas.nameParams } }, async (request, reply) => { s.removeIndex(name(request)); return reply.code(204).send(); });
    api.post('/indexes/:name/clear', { config: { audit: AuditClient.route('search.index.clear', (r) => ({ type: 'index', id: /** @type {any} */ (r.params).name }), (_r, b) => ({ removed: b?.removed })) }, ...write, schema: { params: Schemas.nameParams } }, async (request) => ({ removed: s.clearIndex(name(request)) }));

    // ---- documents
    api.put('/indexes/:name/documents', { config: { audit: AuditClient.route('search.documents.upsert', (r) => ({ type: 'index', id: /** @type {any} */ (r.params).name }), (_r, b) => ({ created: b?.created, updated: b?.updated })) }, ...write, schema: { params: Schemas.nameParams, body: Schemas.upsert } }, async (request) => s.upsert(name(request), /** @type {{ documents: any[] }} */ (request.body).documents, request.apiKey.id));
    api.get('/indexes/:name/documents', { ...read, schema: { params: Schemas.nameParams, querystring: Schemas.browseQuery } }, async (request) => {
      const q = query(request);
      const r = s.search(name(request), { q: '', limit: q.limit ? Number(q.limit) : 50, offset: q.offset ? Number(q.offset) : 0, sort: 'newest' });
      return { items: r.hits.map(({ score: _s, ...d }) => d), total: r.total, limit: r.limit, offset: r.offset };
    });
    api.get('/indexes/:name/documents/:id', { ...read, schema: { params: Schemas.docParams } }, async (request) => ({ document: Views.document(s.getDocument(name(request), docId(request))) }));
    api.delete('/indexes/:name/documents/:id', { config: { audit: AuditClient.route('search.document.delete', (r) => ({ type: 'document', id: /** @type {any} */ (r.params).id }), (r) => ({ index: /** @type {any} */ (r.params).name })) }, ...write, schema: { params: Schemas.docParams } }, async (request, reply) => { s.removeDocument(name(request), docId(request)); return reply.code(204).send(); });

    // ---- search
    api.get('/indexes/:name/search', { ...read, schema: { params: Schemas.nameParams, querystring: Schemas.searchQuery } }, async (request) => {
      const q = query(request);
      /** @type {Record<string, string[]>} */ const filters = {};
      for (const [k, v] of Object.entries(q)) if (k.startsWith('filter.') && v !== undefined) filters[k.slice(7)] = v.split(',');
      return s.search(name(request), { q: q.q ?? '', filters, facets: q.facets ? q.facets.split(',') : undefined, limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined, highlight: q.highlight === 'true', sort: /** @type {any} */ (q.sort) });
    });
    api.post('/indexes/:name/search', { ...read, schema: { params: Schemas.nameParams, body: Schemas.searchBody } }, async (request) => s.search(name(request), /** @type {any} */ (request.body ?? {})));
    api.get('/indexes/:name/suggest', { ...read, schema: { params: Schemas.nameParams, querystring: Schemas.suggestQuery } }, async (request) => {
      const q = query(request);
      return { items: s.suggest(name(request), /** @type {string} */ (q.q), q.limit ? Number(q.limit) : undefined) };
    });

    api.get('/stats', read, async (request) => {
      const counts = this.indexes.counts();
      const items = visible(request).map((i) => view(i, counts));
      return { indexes: items.length, documents: items.reduce((a, i) => a + i.documents, 0), searchesSinceStart: items.reduce((a, i) => a + i.searchesSinceStart, 0), dbBytes: this.db.sizeBytes(), items: items.map((i) => ({ name: i.name, documents: i.documents, searchesSinceStart: i.searchesSinceStart, lastIndexedAt: i.lastIndexedAt })) };
    });
  }

  /** @param {FastifyInstance} ops */
  #registerMetrics(ops) {
    ops.addHook('onRequest', this.auth.hook);
    ops.get('/metrics', { logLevel: 'warn', preValidation: ApiKeyAuth.require('read') }, async (_request, reply) => {
      const counts = this.indexes.counts();
      const all = this.indexes.all();
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return [
        '# HELP search_indexes Indexes.',
        '# TYPE search_indexes gauge',
        `search_indexes ${all.length}`,
        '# HELP search_documents Documents per index.',
        '# TYPE search_documents gauge',
        ...all.map((i) => `search_documents{index="${i.name}"} ${counts.get(i.name)?.documents ?? 0}`),
        '# HELP search_documents_total Documents in every index.',
        '# TYPE search_documents_total gauge',
        `search_documents_total ${this.documents.total()}`,
        '# HELP search_queries_total Search requests since process start, per index.',
        '# TYPE search_queries_total counter',
        ...all.map((i) => `search_queries_total{index="${i.name}"} ${this.service.searches.get(i.name) ?? 0}`),
        '# HELP search_db_bytes Database size.',
        '# TYPE search_db_bytes gauge',
        `search_db_bytes ${this.db.sizeBytes()}`,
        '# HELP search_process_uptime_seconds Process uptime.',
        '# TYPE search_process_uptime_seconds gauge',
        `search_process_uptime_seconds ${process.uptime().toFixed(0)}`,
        '',
      ].join('\n');
    });
  }
}
