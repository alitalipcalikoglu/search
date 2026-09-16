import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Highlighter } from '../src/domain/highlighter.js';
import { QueryParser } from '../src/domain/query-parser.js';
import { TextFold } from '../src/domain/text-fold.js';

test('TextFold: case, diacritics, Turkish i', () => {
  assert.equal(TextFold.fold('Kırmızı ÇİLEK reçeli İstanbul Straße'), 'kirmizi cilek receli istanbul straße');
  assert.deepEqual(TextFold.tokens('a-b, c9!').map((t) => [t.text, t.start, t.end]), [['a', 0, 1], ['b', 2, 3], ['c9', 5, 7]]);
});

test('QueryParser: words, phrases, exclusions, prefix on the last word, safe against FTS syntax', () => {
  assert.deepEqual(QueryParser.parse('Kırmızı elbise'), { match: '"kirmizi" AND "elbise"*', terms: [{ text: 'kirmizi', prefix: false }, { text: 'elbise', prefix: true }] });
  assert.equal(QueryParser.parse('"yazlık elbise" pamuk -polyester').match, '"yazlik elbise" AND "pamuk" NOT "polyester"');
  assert.equal(QueryParser.parse('a OR b NEAR(c) col:x ^*').match, '"a" AND "or" AND "b" AND "near c" AND "col x"*', 'operators are plain words; punctuation-joined input becomes a phrase; the last usable term gets the prefix');
  assert.deepEqual(QueryParser.parse('  -  "" '), { match: '', terms: [] });
  assert.equal(QueryParser.parse('-pamuk').match, '', 'an exclusion alone matches nothing to exclude from');
  assert.throws(() => QueryParser.parse('x'.repeat(501)), /500 characters/);
});

test('Highlighter: marks original spelling, escapes HTML, snippets around the first hit', () => {
  const h = new Highlighter(QueryParser.parse('kirmizi elb').terms);
  assert.equal(h.mark('Kırmızı <b>Elbise</b> & mavi'), '<mark>Kırmızı</mark> &lt;b&gt;<mark>Elbise</mark>&lt;/b&gt; &amp; mavi');
  const body = `${'lorem ipsum '.repeat(30)}Kırmızı elbise burada. ${'dolor sit '.repeat(20)}`;
  const s = h.snippet(body, 80);
  assert.ok(s.startsWith('…') && s.endsWith('…') && s.includes('<mark>Kırmızı</mark> <mark>elbise</mark>'), s);
  assert.equal(new Highlighter([]).snippet('short text', 80), 'short text');
});
