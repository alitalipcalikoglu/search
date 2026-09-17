import { ApiKeyAuth as CoreApiKeyAuth } from '@atc-web/service-core/auth';
import { SearchError } from '../domain/errors.js';

/** @typedef {import('../types.js').ApiKey} ApiKey */

/**
 * Bearer API-key authentication with read/write roles and optional index scoping. Thin wrapper
 * over service-core's `ApiKeyAuth`.
 */
export class ApiKeyAuth {
  /** @param {ApiKey[]} apiKeys */
  constructor(apiKeys) {
    this.core = new CoreApiKeyAuth(apiKeys);
  }

  /** Fastify `onRequest` hook. */
  get hook() {
    return this.core.hook;
  }

  /**
   * Route-level guard on role.
   * @param {'read'|'write'} need
   */
  static require(need) {
    return CoreApiKeyAuth.require(need, {
      roleOf: (request) => /** @type {any} */ (request).apiKey?.role,
      makeError: (n) => new SearchError('FORBIDDEN', `this API key has no ${n} access`),
    });
  }

  /**
   * Index guard: a key scoped to some indexes may not touch others.
   * @param {ApiKey} key
   * @param {string} index
   */
  static assertIndex(key, index) {
    CoreApiKeyAuth.assertScope(/** @type {any} */ ({ scopes: key.indexes }), index, (name) => new SearchError('FORBIDDEN', `this API key has no access to index "${name}"`));
  }

  /**
   * @param {string} secret Presented secret.
   * @returns {ApiKey|undefined} Matching key.
   */
  identify(secret) {
    return /** @type {ApiKey|undefined} */ (/** @type {any} */ (this.core.identify(secret)));
  }
}
