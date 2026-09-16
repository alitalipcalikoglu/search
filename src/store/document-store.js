import { TextFold } from '../domain/text-fold.js';

/** @typedef {import('../db.js').Database} Database */
/** @typedef {import('../types.js').DocumentRow} DocumentRow */
/** @typedef {import('../types.js').Weights} Weights */

/**
 * Documents, their folded full-text rows and their attribute rows, written together. Search
 * queries join the three; filters are EXISTS subqueries on the attribute table.
 */
export class DocumentStore {
  static COLUMNS = 'rowid, index_name, id, title, body, tags, attrs, url, source, created_at, updated_at';

  /** @param {Database} db */
  constructor(db) {
    this.db = db;
    const C = DocumentStore.COLUMNS;
    this.stmt = {
      get: db.prepare(`SELECT ${C} FROM documents WHERE index_name = ? AND id = ?`),
      byRowid: db.prepare(`SELECT ${C} FROM documents WHERE rowid = ?`),
      insert: db.prepare(`INSERT INTO documents (index_name, id, title, body, tags, attrs, url, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      update: db.prepare(`UPDATE documents SET title = ?, body = ?, tags = ?, attrs = ?, url = ?, source = ?, updated_at = ? WHERE rowid = ?`),
      delete: db.prepare(`DELETE FROM documents WHERE index_name = ? AND id = ?`),
      clear: db.prepare(`DELETE FROM documents WHERE index_name = ?`),
      rowids: db.prepare(`SELECT rowid FROM documents WHERE index_name = ?`),
      ftsInsert: db.prepare(`INSERT INTO documents_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)`),
      ftsDelete: db.prepare(`DELETE FROM documents_fts WHERE rowid = ?`),
      attrsDelete: db.prepare(`DELETE FROM document_attrs WHERE doc_rowid = ?`),
      attrInsert: db.prepare(`INSERT INTO document_attrs (doc_rowid, index_name, key, value) VALUES (?, ?, ?, ?)`),
      total: db.prepare(`SELECT COUNT(*) AS n FROM documents`),
    };
    /** @type {Map<string, import('node:sqlite').StatementSync>} */
    this.cache = new Map();
  }

  /** @param {string} index @param {string} id */
  get(index, id) {
    return /** @type {DocumentRow|undefined} */ (this.stmt.get.get(index, id));
  }

  /**
   * Insert or replace one document with its full-text and attribute rows. Caller holds the transaction.
   * @param {{ index: string, id: string, title: string, body: string, tags: string[], attrs: Record<string, unknown>, url: string|null, source: string }} d
   * @param {[string, string][]} attrRows  Flattened `[key, value]` pairs.
   * @param {number} now
   * @returns {'created'|'updated'}
   */
  upsert(d, attrRows, now) {
    const existing = this.get(d.index, d.id);
    let rowid;
    let outcome = /** @type {'created'|'updated'} */ ('created');
    if (existing) {
      rowid = Number(existing.rowid);
      this.stmt.update.run(d.title, d.body, JSON.stringify(d.tags), JSON.stringify(d.attrs), d.url, d.source, now, rowid);
      this.stmt.ftsDelete.run(rowid);
      this.stmt.attrsDelete.run(rowid);
      outcome = 'updated';
    } else {
      rowid = Number(this.stmt.insert.run(d.index, d.id, d.title, d.body, JSON.stringify(d.tags), JSON.stringify(d.attrs), d.url, d.source, now, now).lastInsertRowid);
    }
    this.stmt.ftsInsert.run(rowid, TextFold.fold(d.title), TextFold.fold(d.body), TextFold.fold(d.tags.join(' ')));
    for (const [k, v] of attrRows) this.stmt.attrInsert.run(rowid, d.index, k, v);
    return outcome;
  }

  /** @param {string} index @param {string} id */
  delete(index, id) {
    const existing = this.get(index, id);
    if (!existing) return false;
    this.stmt.ftsDelete.run(Number(existing.rowid));
    this.stmt.delete.run(index, id);
    return true;
  }

  /** Remove every document of an index (full-text rows included). @param {string} index */
  clear(index) {
    const rows = /** @type {{ rowid: number }[]} */ (this.stmt.rowids.all(index));
    for (const r of rows) this.stmt.ftsDelete.run(Number(r.rowid));
    return Number(this.stmt.clear.run(index).changes);
  }

  total() {
    return Number(/** @type {{ n: number }} */ (this.stmt.total.get()).n);
  }

  /**
   * Ranked search. `match` empty = browse (newest first) with filters only.
   * @param {object} q
   * @param {string} q.index
   * @param {string} q.match
   * @param {Weights} q.weights
   * @param {Record<string, string[]>} q.filters
   * @param {'relevance'|'newest'|'oldest'} q.sort
   * @param {number} q.limit
   * @param {number} q.offset
   * @returns {{ total: number, rows: (DocumentRow & { rank: number })[] }}
   */
  search({ index, match, weights, filters, sort, limit, offset }) {
    const { where, params } = this.#where(index, match, filters);
    const from = match ? 'FROM documents_fts f JOIN documents d ON d.rowid = f.rowid' : 'FROM documents d';
    const rank = match ? `bm25(documents_fts, ${weights.title}, ${weights.body}, ${weights.tags})` : '0';
    const order = sort === 'newest' ? 'd.updated_at DESC, d.rowid DESC' : sort === 'oldest' ? 'd.updated_at ASC, d.rowid ASC' : match ? 'rank ASC, d.updated_at DESC' : 'd.updated_at DESC, d.rowid DESC';
    const cols = DocumentStore.COLUMNS.split(', ').map((c) => `d.${c}`).join(', ');
    const rows = /** @type {(DocumentRow & { rank: number })[]} */ (this.#stmt(`SELECT ${cols}, ${rank} AS rank ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset));
    const total = Number(/** @type {{ n: number }} */ (this.#stmt(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...params)).n);
    return { total, rows };
  }

  /**
   * Value counts for one attribute key over the matched set.
   * @param {{ index: string, match: string, filters: Record<string, string[]>, key: string, limit: number }} q
   */
  facet({ index, match, filters, key, limit }) {
    const { where, params } = this.#where(index, match, filters);
    const from = match ? 'FROM documents_fts f JOIN documents d ON d.rowid = f.rowid' : 'FROM documents d';
    const sql = `SELECT a.value, COUNT(*) AS n ${from} JOIN document_attrs a ON a.doc_rowid = d.rowid AND a.key = ? WHERE ${where} GROUP BY a.value ORDER BY n DESC, a.value LIMIT ?`;
    return /** @type {{ value: string, n: number }[]} */ (this.#stmt(sql).all(key, ...params, limit)).map((r) => ({ value: r.value, count: Number(r.n) }));
  }

  /**
   * Titles starting with the folded prefix, for type-ahead.
   * @param {string} index @param {string} match @param {number} limit
   */
  suggest(index, match, limit) {
    const rows = /** @type {{ id: string, title: string }[]} */ (this.#stmt(`SELECT d.id, d.title FROM documents_fts f JOIN documents d ON d.rowid = f.rowid WHERE documents_fts MATCH ? AND d.index_name = ? ORDER BY bm25(documents_fts, 10, 1, 1) LIMIT ?`).all(match, index, limit));
    return rows;
  }

  /**
   * @param {string} index
   * @param {string} match
   * @param {Record<string, string[]>} filters
   */
  #where(index, match, filters) {
    /** @type {string[]} */ const where = ['d.index_name = ?'];
    /** @type {(string|number)[]} */ const params = [index];
    if (match) { where.unshift('documents_fts MATCH ?'); params.unshift(match); }
    for (const [key, values] of Object.entries(filters)) {
      if (!values.length) continue;
      where.push(`EXISTS (SELECT 1 FROM document_attrs a WHERE a.doc_rowid = d.rowid AND a.key = ? AND a.value IN (${values.map(() => '?').join(', ')}))`);
      params.push(key, ...values);
    }
    return { where: where.join(' AND '), params };
  }

  /** @param {string} sql */
  #stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
}
