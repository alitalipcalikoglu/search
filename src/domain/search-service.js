import { SearchError } from './errors.js';
import { Highlighter } from './highlighter.js';
import { QueryParser } from './query-parser.js';
import { TextFold } from './text-fold.js';

/** @typedef {import('../types.js').IndexRow} IndexRow */
/** @typedef {import('../types.js').DocumentInput} DocumentInput */
/** @typedef {import('../types.js').DocumentRow} DocumentRow */
/** @typedef {import('../types.js').Weights} Weights */
/** @typedef {import('../types.js').SearchQuery} SearchQuery */

/** Index lifecycle, document validation and bulk indexing, ranked search with facets, suggestions. */
export class SearchService {
  static NAME = /^[a-z0-9]+([.\-_][a-z0-9]+)*$/;
  static ATTR_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
  static DEFAULT_WEIGHTS = /** @type {Weights} */ ({ title: 5, body: 1, tags: 3 });

  /**
   * @param {object} deps
   * @param {import('../db.js').Database} deps.db
   * @param {import('../store/index-store.js').IndexStore} deps.indexes
   * @param {import('../store/document-store.js').DocumentStore} deps.documents
   * @param {{ maxBatch: number, maxDocBytes: number, maxAttrs: number, maxPage: number, maxOffset: number, maxFacetValues: number }} deps.options
   * @param {() => number} [deps.now]
   */
  constructor({ db, indexes, documents, options, now = Date.now }) {
    this.db = db;
    this.indexes = indexes;
    this.documents = documents;
    this.options = options;
    this.now = now;
    /** Searches served since start, per index. @type {Map<string, number>} */
    this.searches = new Map();
  }

  // ---- indexes

  /**
   * @param {{ name: string, description?: string, weights?: Partial<Weights>, facets?: string[] }} input
   * @param {string} actor
   */
  createIndex(input, actor) {
    if (this.indexes.get(input.name)) throw new SearchError('INDEX_EXISTS', `index "${input.name}" already exists`);
    const now = this.now();
    return this.indexes.insert({ name: input.name, description: input.description ?? '', weights: JSON.stringify(SearchService.#weights(input.weights)), facets: JSON.stringify(SearchService.#facets(input.facets)), created_by: actor, created_at: now, updated_at: now });
  }

  /** @param {string} name */
  getIndex(name) {
    return this.indexes.require(name);
  }

  /**
   * @param {string} name
   * @param {{ description?: string, weights?: Partial<Weights>, facets?: string[] }} patch
   */
  updateIndex(name, patch) {
    const row = this.indexes.require(name);
    return this.indexes.update({
      ...row,
      description: patch.description ?? row.description,
      weights: patch.weights === undefined ? row.weights : JSON.stringify(SearchService.#weights({ ...JSON.parse(row.weights), ...patch.weights })),
      facets: patch.facets === undefined ? row.facets : JSON.stringify(SearchService.#facets(patch.facets)),
      updated_at: this.now(),
    });
  }

  /** Deletes the index and every document in it. @param {string} name */
  removeIndex(name) {
    this.indexes.require(name);
    this.db.transaction(() => { this.documents.clear(name); this.indexes.delete(name); });
  }

  /** @param {string} name */
  clearIndex(name) {
    this.indexes.require(name);
    return this.db.transaction(() => this.documents.clear(name));
  }

  // ---- documents

  /**
   * Validate and index a batch in one transaction: either every document lands or none.
   * @param {string} index
   * @param {DocumentInput[]} docs
   * @param {string} source
   */
  upsert(index, docs, source) {
    this.indexes.require(index);
    if (docs.length > this.options.maxBatch) throw new SearchError('BATCH_TOO_LARGE', `at most ${this.options.maxBatch} documents per request`);
    const prepared = docs.map((d, i) => this.#validate(d, i));
    const ids = new Set(prepared.map((p) => p.doc.id));
    if (ids.size !== prepared.length) throw new SearchError('INVALID_DOCUMENT', 'duplicate ids in one batch');
    return this.db.transaction(() => {
      const now = this.now();
      let created = 0;
      let updated = 0;
      for (const p of prepared) {
        if (this.documents.upsert({ index, source, ...p.doc }, p.attrRows, now) === 'created') created++;
        else updated++;
      }
      return { created, updated };
    });
  }

  /** @param {string} index @param {string} id */
  getDocument(index, id) {
    this.indexes.require(index);
    const row = this.documents.get(index, id);
    if (!row) throw new SearchError('DOCUMENT_NOT_FOUND', `document "${id}" not found in "${index}"`);
    return row;
  }

  /** @param {string} index @param {string} id */
  removeDocument(index, id) {
    this.indexes.require(index);
    if (!this.db.transaction(() => this.documents.delete(index, id))) throw new SearchError('DOCUMENT_NOT_FOUND', `document "${id}" not found in "${index}"`);
  }

  // ---- search

  /**
   * @param {string} index
   * @param {SearchQuery} q
   */
  search(index, q) {
    const row = this.indexes.require(index);
    const limit = Math.min(q.limit ?? 20, this.options.maxPage);
    const offset = q.offset ?? 0;
    if (offset > this.options.maxOffset) throw new SearchError('INVALID_QUERY', `offset must be <= ${this.options.maxOffset}`);
    const filters = SearchService.#filters(q.filters);
    const parsed = QueryParser.parse(q.q ?? '');
    const weights = /** @type {Weights} */ (JSON.parse(row.weights));
    const { total, rows } = this.documents.search({ index, match: parsed.match, weights, filters, sort: q.sort ?? 'relevance', limit, offset });
    const hl = q.highlight ? new Highlighter(parsed.terms) : null;
    const facetKeys = SearchService.#facets(q.facets);
    const facets = Object.fromEntries(facetKeys.map((key) => [key, this.documents.facet({ index, match: parsed.match, filters, key, limit: this.options.maxFacetValues })]));
    this.searches.set(index, (this.searches.get(index) ?? 0) + 1);
    return {
      total, limit, offset, query: parsed.match,
      hits: rows.map((r) => ({ ...SearchService.view(r), score: parsed.match ? -Number(r.rank) : null, ...(hl ? { highlights: { title: hl.mark(r.title), body: hl.snippet(r.body) } } : {}) })),
      facets,
    };
  }

  /**
   * Type-ahead on titles.
   * @param {string} index @param {string} q @param {number} [limit]
   */
  suggest(index, q, limit = 10) {
    this.indexes.require(index);
    const words = TextFold.tokens(TextFold.fold(q)).map((t) => t.text);
    if (!words.length) return [];
    const match = `title : "${words.join(' ')}"*`;
    return this.documents.suggest(index, match, Math.min(limit, this.options.maxPage));
  }

  /** @param {DocumentRow} r */
  static view(r) {
    return { id: r.id, title: r.title, body: r.body, tags: /** @type {string[]} */ (JSON.parse(r.tags)), attrs: JSON.parse(r.attrs), url: r.url, source: r.source, createdAt: new Date(Number(r.created_at)).toISOString(), updatedAt: new Date(Number(r.updated_at)).toISOString() };
  }

  /**
   * @param {DocumentInput} d
   * @param {number} i
   */
  #validate(d, i) {
    const at = `documents[${i}]`;
    if (typeof d.id !== 'string' || !d.id || d.id.length > 200) throw new SearchError('INVALID_DOCUMENT', `${at}.id must be a string of 1-200 characters`);
    if (typeof d.title !== 'string' || !d.title.trim()) throw new SearchError('INVALID_DOCUMENT', `${at}.title is required`);
    const tags = [...new Set((d.tags ?? []).map((t) => String(t).trim()).filter(Boolean))];
    /** @type {[string, string][]} */ const attrRows = tags.map((t) => ['tags', t]);
    /** @type {Record<string, unknown>} */ const attrs = {};
    for (const [key, value] of Object.entries(d.attrs ?? {})) {
      if (!SearchService.ATTR_KEY.test(key) || key === 'tags') throw new SearchError('INVALID_DOCUMENT', `${at}.attrs key "${key}" is not allowed`);
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (!['string', 'number', 'boolean'].includes(typeof v)) throw new SearchError('INVALID_DOCUMENT', `${at}.attrs.${key} must be a string, number, boolean or an array of strings`);
        attrRows.push([key, String(v)]);
      }
      attrs[key] = value;
    }
    if (attrRows.length > this.options.maxAttrs) throw new SearchError('INVALID_DOCUMENT', `${at} has more than ${this.options.maxAttrs} attribute values`);
    const doc = { id: d.id, title: d.title.trim(), body: (d.body ?? '').trim(), tags, attrs, url: d.url ?? null };
    const bytes = Buffer.byteLength(JSON.stringify(doc));
    if (bytes > this.options.maxDocBytes) throw new SearchError('DOCUMENT_TOO_LARGE', `${at} is ${bytes} bytes, limit ${this.options.maxDocBytes}`);
    return { doc, attrRows };
  }

  /** @param {Partial<Weights>|undefined} w @returns {Weights} */
  static #weights(w) {
    const out = { ...SearchService.DEFAULT_WEIGHTS, ...w };
    for (const [k, v] of Object.entries(out)) if (typeof v !== 'number' || !(v >= 0 && v <= 100)) throw new SearchError('INVALID_QUERY', `weight ${k} must be between 0 and 100`);
    return out;
  }

  /** @param {string[]|undefined} keys */
  static #facets(keys) {
    const out = [...new Set((keys ?? []).map((k) => k.trim()).filter(Boolean))];
    if (out.length > 20) throw new SearchError('INVALID_QUERY', 'at most 20 facets');
    for (const k of out) if (!SearchService.ATTR_KEY.test(k) && k !== 'tags') throw new SearchError('INVALID_QUERY', `facet "${k}" is not a valid attribute key`);
    return out;
  }

  /** @param {Record<string, string[]>|undefined} filters */
  static #filters(filters) {
    /** @type {Record<string, string[]>} */ const out = {};
    for (const [k, v] of Object.entries(filters ?? {})) {
      if (!SearchService.ATTR_KEY.test(k) && k !== 'tags') throw new SearchError('INVALID_QUERY', `filter "${k}" is not a valid attribute key`);
      const values = (Array.isArray(v) ? v : [v]).map(String).filter((x) => x !== '');
      if (values.length > 50) throw new SearchError('INVALID_QUERY', `filter "${k}" has more than 50 values`);
      if (values.length) out[k] = values;
    }
    return out;
  }
}
