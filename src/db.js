import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** SQLite connection with schema migrations applied on open. */
export class Database {
  /** @type {readonly string[]} */
  static MIGRATIONS = [
    `
    CREATE TABLE indexes (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      weights     TEXT NOT NULL,
      facets      TEXT NOT NULL DEFAULT '[]',
      created_by  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE documents (
      rowid      INTEGER PRIMARY KEY AUTOINCREMENT,
      index_name TEXT NOT NULL REFERENCES indexes(name) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      tags       TEXT NOT NULL DEFAULT '[]',
      attrs      TEXT NOT NULL DEFAULT '{}',
      url        TEXT,
      source     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (index_name, id)
    );
    CREATE INDEX documents_index_updated ON documents (index_name, updated_at DESC, rowid DESC);

    -- Full-text index over folded copies of title, body and tags (see TextFold): case, diacritics and
    -- Turkish dotted/dotless i are folded before indexing and before matching, so "kirmizi" finds
    -- "Kırmızı". The store writes this table together with documents; there are no triggers.
    CREATE VIRTUAL TABLE documents_fts USING fts5(title, body, tags, tokenize='unicode61');

    -- One row per scalar attribute value (array elements and tags included): filters and facets.
    CREATE TABLE document_attrs (
      doc_rowid  INTEGER NOT NULL REFERENCES documents(rowid) ON DELETE CASCADE,
      index_name TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL
    );
    CREATE INDEX document_attrs_lookup ON document_attrs (index_name, key, value, doc_rowid);
    CREATE INDEX document_attrs_doc ON document_attrs (doc_rowid);
    `,
  ];

  /** @param {string} path File path, or ":memory:". */
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    /** @readonly */
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.#migrate();
  }

  #migrate() {
    const { user_version: current } = /** @type {{ user_version: number }} */ (this.raw.prepare('PRAGMA user_version').get());
    for (let v = current; v < Database.MIGRATIONS.length; v++) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(Database.MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
        this.raw.exec('COMMIT');
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      }
    }
  }

  /** @param {string} sql */
  prepare(sql) {
    return this.raw.prepare(sql);
  }

  /**
   * Run `fn` inside a write transaction; rolls back on throw.
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  transaction(fn) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  /** Cheap liveness probe; throws if the connection is unusable. */
  ping() {
    this.raw.prepare('SELECT 1').get();
  }

  /** Database file size in bytes. */
  sizeBytes() {
    const r = /** @type {{ bytes: number }} */ (this.raw.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()').get());
    return Number(r.bytes);
  }

  close() {
    this.raw.close();
  }
}
