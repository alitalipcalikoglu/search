import { Database as CoreDatabase } from '@atc-web/service-core/db';

/** SQLite connection with schema migrations applied on open. */
export class Database extends CoreDatabase {
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
}
