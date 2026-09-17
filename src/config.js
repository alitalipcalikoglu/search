import { ConfigError, EnvReader, parseApiKeys, parseAudit } from '@atc-web/service-core/config';

/** @typedef {import('./types.js').ApiKey} ApiKey */
/** @typedef {import('./types.js').KeyRole} KeyRole */

export { ConfigError };

/** Validated service configuration. Build with {@link Config.fromEnv}. */
export class Config {
  static MIN_SECRET_LENGTH = 32;
  static INDEX_PATTERN = /^[a-z0-9]+([.\-_][a-z0-9]+)*$/;
  static ROLES = ['read', 'write', 'readwrite'];

  /** @param {import('./types.js').ConfigValues} v */
  constructor(v) {
    this.port = v.port;
    this.host = v.host;
    this.logLevel = v.logLevel;
    this.trustProxy = v.trustProxy;
    this.tls = v.tls;
    this.audit = v.audit;
    this.bodyLimit = v.bodyLimit;
    this.dbPath = v.dbPath;
    this.apiKeys = v.apiKeys;
    this.rateLimitMax = v.rateLimitMax;
    this.maxBatch = v.maxBatch;
    this.maxDocBytes = v.maxDocBytes;
    this.maxAttrs = v.maxAttrs;
    this.maxPage = v.maxPage;
    this.maxOffset = v.maxOffset;
    this.maxFacetValues = v.maxFacetValues;
    Object.freeze(this);
  }

  /**
   * @param {NodeJS.ProcessEnv} [env]
   * @returns {Config}
   */
  static fromEnv(env = process.env) {
    const r = new EnvReader(env);

    const certPath = r.optional('TLS_CERT_PATH');
    const keyPath = r.optional('TLS_KEY_PATH');
    if (Boolean(certPath) !== Boolean(keyPath)) throw new ConfigError('TLS_CERT_PATH and TLS_KEY_PATH must be set together');

    return new Config({
      port: r.integer('PORT', 3010, { min: 0, max: 65535 }),
      host: r.optional('HOST') || '0.0.0.0',
      logLevel: r.optional('LOG_LEVEL') || 'info',
      trustProxy: r.boolean('TRUST_PROXY', false),
      tls: certPath ? { certPath, keyPath } : null,
      audit: parseAudit(r),
      bodyLimit: r.integer('BODY_LIMIT', 8_388_608, { min: 1_024 }),
      dbPath: r.optional('DB_PATH') || './data/search.db',
      apiKeys: Config.#parseApiKeys(r.required('SEARCH_API_KEYS')),
      rateLimitMax: r.integer('RATE_LIMIT_MAX', 1_200, { min: 1 }),
      maxBatch: r.integer('MAX_BATCH', 500, { min: 1, max: 10_000 }),
      maxDocBytes: r.integer('MAX_DOC_BYTES', 65_536, { min: 256 }),
      maxAttrs: r.integer('MAX_ATTRS', 50, { min: 1, max: 500 }),
      maxPage: r.integer('MAX_PAGE', 100, { min: 1, max: 1_000 }),
      maxOffset: r.integer('MAX_OFFSET', 10_000, { min: 0 }),
      maxFacetValues: r.integer('MAX_FACET_VALUES', 20, { min: 1, max: 200 }),
    });
  }

  /**
   * Parse `id:secret[:role[:index+index]]`. Role defaults to `readwrite`, indexes to all. Index
   * names are not checked against existing indexes: keys may be issued before an index is created.
   * @param {string} raw
   * @returns {ApiKey[]}
   */
  static #parseApiKeys(raw) {
    return parseApiKeys(raw, 'SEARCH_API_KEYS', { roles: Config.ROLES, scopePattern: Config.INDEX_PATTERN, scopeNoun: 'index', minSecretLength: Config.MIN_SECRET_LENGTH })
      .map(({ id, secret, role, scopes }) => ({ id, secret, role: /** @type {KeyRole} */ (role), indexes: scopes }));
  }
}
