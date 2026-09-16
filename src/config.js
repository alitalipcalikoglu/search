/** @typedef {import('./types.js').ApiKey} ApiKey */
/** @typedef {import('./types.js').KeyRole} KeyRole */

export class ConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validated service configuration. Build with {@link Config.fromEnv}. */
export class Config {
  static MIN_SECRET_LENGTH = 32;
  static INDEX_PATTERN = /^[a-z0-9]+([.\-_][a-z0-9]+)*$/;

  /** @param {import('./types.js').ConfigValues} v */
  constructor(v) {
    this.port = v.port;
    this.host = v.host;
    this.logLevel = v.logLevel;
    this.trustProxy = v.trustProxy;
    this.tls = v.tls;
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
    const keys = raw.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
      const parts = entry.split(':');
      if (parts.length < 2 || parts.length > 4) throw new ConfigError(`SEARCH_API_KEYS entry "${entry.slice(0, 8)}…" must be id:secret[:role[:indexes]]`);
      const [id, secret, role = 'readwrite', indexList = ''] = parts;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ConfigError(`SEARCH_API_KEYS id "${id}" must match [A-Za-z0-9_-]{1,64}`);
      if (secret.length < Config.MIN_SECRET_LENGTH) throw new ConfigError(`SEARCH_API_KEYS secret for "${id}" must be at least ${Config.MIN_SECRET_LENGTH} characters`);
      if (role !== 'read' && role !== 'write' && role !== 'readwrite') throw new ConfigError(`SEARCH_API_KEYS role for "${id}" must be read, write or readwrite`);
      let indexes = null;
      if (indexList) {
        indexes = indexList.split('+').map((s) => s.trim()).filter(Boolean);
        for (const i of indexes) if (!Config.INDEX_PATTERN.test(i)) throw new ConfigError(`SEARCH_API_KEYS key "${id}" names an invalid index "${i}"`);
      }
      return { id, secret, role: /** @type {KeyRole} */ (role), indexes };
    });
    if (keys.length === 0) throw new ConfigError('SEARCH_API_KEYS must contain at least one key');
    if (new Set(keys.map((k) => k.id)).size !== keys.length) throw new ConfigError('SEARCH_API_KEYS ids must be unique');
    if (new Set(keys.map((k) => k.secret)).size !== keys.length) throw new ConfigError('SEARCH_API_KEYS secrets must be unique');
    return keys;
  }
}

/** Typed accessors over a raw environment map. */
class EnvReader {
  /** @param {NodeJS.ProcessEnv} env */
  constructor(env) {
    this.env = env;
  }

  /** @param {string} name */
  optional(name) {
    return this.env[name]?.trim() ?? '';
  }

  /** @param {string} name */
  required(name) {
    const v = this.optional(name);
    if (v === '') throw new ConfigError(`${name} is required`);
    return v;
  }

  /**
   * @param {string} name
   * @param {number} fallback
   * @param {{ min?: number, max?: number }} [range]
   */
  integer(name, fallback, range = {}) {
    const raw = this.optional(name);
    if (raw === '') return fallback;
    if (!/^-?\d+$/.test(raw)) throw new ConfigError(`${name} must be an integer, got "${raw}"`);
    const n = Number(raw);
    if (range.min !== undefined && n < range.min) throw new ConfigError(`${name} must be >= ${range.min}`);
    if (range.max !== undefined && n > range.max) throw new ConfigError(`${name} must be <= ${range.max}`);
    return n;
  }

  /**
   * @param {string} name
   * @param {boolean} fallback
   */
  boolean(name, fallback) {
    const raw = this.optional(name);
    if (raw === '') return fallback;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    throw new ConfigError(`${name} must be true or false, got "${raw}"`);
  }
}
