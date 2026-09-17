import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config, ConfigError } from '../src/config.js';
import { testEnv } from './helpers.js';

test('Config: defaults, key roles and index scopes', () => {
  const c = Config.fromEnv(testEnv());
  assert.deepEqual(c.apiKeys.map((k) => [k.id, k.role, k.indexes]), [['console', 'readwrite', null], ['site', 'read', null], ['indexer', 'write', null], ['shop', 'readwrite', ['products', 'docs']]]);
  assert.deepEqual([c.maxBatch, c.maxDocBytes, c.maxPage, c.maxOffset, c.maxFacetValues, c.bodyLimit], [5, 65_536, 100, 10_000, 20, 8_388_608]);
  assert.ok(Object.isFrozen(c));
});

test('Config: rejects bad input', () => {
  const bad = (/** @type {Record<string,string>} */ o, /** @type {RegExp} */ re) => assert.throws(() => Config.fromEnv(testEnv(o)), (e) => e instanceof ConfigError && re.test(e.message));
  bad({ SEARCH_API_KEYS: '' }, /SEARCH_API_KEYS is required/);
  bad({ SEARCH_API_KEYS: 'a:short' }, /at least 32/);
  bad({ SEARCH_API_KEYS: `a:${'a'.repeat(40)}:owner` }, /read, write or readwrite/);
  bad({ SEARCH_API_KEYS: `a:${'a'.repeat(40)}:read:Bad Index` }, /invalid index/);
  bad({ MAX_BATCH: '0' }, />= 1/);
  bad({ TLS_CERT_PATH: '/x.pem' }, /must be set together/);
});
