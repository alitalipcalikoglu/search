/**
 * Shared JSDoc typedefs for the search service. No runtime exports.
 */

/** @typedef {'read'|'write'|'readwrite'} KeyRole */

/**
 * @typedef {object} ApiKey
 * @property {string} id
 * @property {string} secret
 * @property {KeyRole} role
 * @property {string[]|null} indexes   Indexes this key may touch; null = all.
 */

/**
 * Plain values accepted by the `Config` constructor.
 * @typedef {object} ConfigValues
 * @property {number} port
 * @property {string} host
 * @property {string} logLevel
 * @property {boolean} trustProxy
 * @property {{ certPath: string, keyPath: string }|null} tls
 * @property {{ url: string, apiKey: string }|null} audit   Audit service to forward events to; null = off.
 * @property {number} bodyLimit
 * @property {string} dbPath
 * @property {string} [dbBackupDir]
 * @property {ApiKey[]} apiKeys
 * @property {number} rateLimitMax
 * @property {number} maxBatch
 * @property {number} maxDocBytes
 * @property {number} maxAttrs
 * @property {number} maxPage
 * @property {number} maxOffset
 * @property {number} maxFacetValues
 */

/** @typedef {import('./config.js').Config} Config */

/**
 * Column weights for ranking; higher = a hit there counts more.
 * @typedef {{ title: number, body: number, tags: number }} Weights
 */

/**
 * @typedef {object} IndexRow
 * @property {string} name
 * @property {string} description
 * @property {string} weights       JSON {@link Weights}.
 * @property {string} facets        JSON string[] of attribute keys the console offers as facets.
 * @property {string} created_by
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * A document as submitted. `attrs` values are strings, numbers, booleans or string arrays; every
 * scalar (and every array element) becomes a filterable, facetable value.
 * @typedef {object} DocumentInput
 * @property {string} id
 * @property {string} title
 * @property {string} [body]
 * @property {string[]} [tags]
 * @property {Record<string, string|number|boolean|string[]>} [attrs]
 * @property {string} [url]
 */

/**
 * @typedef {object} DocumentRow
 * @property {number} rowid
 * @property {string} index_name
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {string} tags          JSON string[].
 * @property {string} attrs         JSON object.
 * @property {string|null} url
 * @property {string} source
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * @typedef {object} SearchQuery
 * @property {string} q
 * @property {Record<string, string[]>} [filters]   AND across keys, OR within a key.
 * @property {string[]} [facets]
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {boolean} [highlight]
 * @property {'relevance'|'newest'|'oldest'} [sort]
 */

/** @typedef {import('fastify').FastifyBaseLogger} Logger */

export {};
