import { SearchError } from '../domain/errors.js';

/** @typedef {import('../db.js').Database} Database */
/** @typedef {import('../types.js').IndexRow} IndexRow */

/** Persistence for index definitions. */
export class IndexStore {
  static COLUMNS = 'name, description, weights, facets, created_by, created_at, updated_at';

  /** @param {Database} db */
  constructor(db) {
    const C = IndexStore.COLUMNS;
    this.stmt = {
      insert: db.prepare(`INSERT INTO indexes (${C}) VALUES (?, ?, ?, ?, ?, ?, ?)`),
      get: db.prepare(`SELECT ${C} FROM indexes WHERE name = ?`),
      all: db.prepare(`SELECT ${C} FROM indexes ORDER BY name`),
      update: db.prepare(`UPDATE indexes SET description = ?, weights = ?, facets = ?, updated_at = ? WHERE name = ?`),
      delete: db.prepare(`DELETE FROM indexes WHERE name = ?`),
      counts: db.prepare(`SELECT index_name, COUNT(*) AS n, MAX(updated_at) AS last FROM documents GROUP BY index_name`),
    };
  }

  /** @param {IndexRow} r */
  insert(r) {
    this.stmt.insert.run(r.name, r.description, r.weights, r.facets, r.created_by, r.created_at, r.updated_at);
    return r;
  }

  /** @param {string} name */
  get(name) {
    return /** @type {IndexRow|undefined} */ (this.stmt.get.get(name));
  }

  /** @param {string} name */
  require(name) {
    const row = this.get(name);
    if (!row) throw new SearchError('INDEX_NOT_FOUND', `index "${name}" not found`);
    return row;
  }

  all() {
    return /** @type {IndexRow[]} */ (this.stmt.all.all());
  }

  /** @param {IndexRow} r */
  update(r) {
    this.stmt.update.run(r.description, r.weights, r.facets, r.updated_at, r.name);
    return r;
  }

  /** @param {string} name */
  delete(name) {
    return Number(this.stmt.delete.run(name).changes) > 0;
  }

  /** Document count and last update per index. */
  counts() {
    return new Map(/** @type {{ index_name: string, n: number, last: number }[]} */ (this.stmt.counts.all()).map((r) => [r.index_name, { documents: Number(r.n), lastIndexedAt: Number(r.last) }]));
  }
}
