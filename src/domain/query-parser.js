import { SearchError } from './errors.js';
import { TextFold } from './text-fold.js';

/**
 * Turns user input into a safe FTS5 MATCH expression. Supported: words (AND), "quoted phrases",
 * `-word` to exclude, and prefix matching on the last word so results appear while typing. Every
 * token is folded like the indexed text and quoted, so FTS5 syntax in the input cannot break the
 * query.
 *
 * @typedef {object} ParsedQuery
 * @property {string} match          FTS5 expression, empty when the input had no usable terms.
 * @property {{ text: string, prefix: boolean }[]} terms   Positive terms, for highlighting.
 */
export class QueryParser {
  static MAX_TERMS = 32;

  /**
   * @param {string} input
   * @returns {ParsedQuery}
   */
  static parse(input) {
    if (input.length > 500) throw new SearchError('INVALID_QUERY', 'query is longer than 500 characters');
    /** @type {string[]} */ const positive = [];
    /** @type {string[]} */ const negative = [];
    /** @type {{ text: string, prefix: boolean }[]} */ const terms = [];
    const parts = [...input.matchAll(/(-?)"([^"]*)"|(-?)(\S+)/g)]
      .map((m) => ({ neg: (m[1] || m[3]) === '-', phrase: m[2] !== undefined, words: TextFold.tokens(TextFold.fold(m[2] ?? m[4])).map((t) => t.text) }))
      .filter((p) => p.words.length);
    parts.forEach((p, i) => {
      const last = i === parts.length - 1 && !p.phrase && !p.neg;
      const expr = `"${p.words.join(' ')}"${last ? '*' : ''}`;
      if (p.neg) negative.push(expr);
      else { positive.push(expr); for (const w of p.words) terms.push({ text: w, prefix: last }); }
    });
    if (terms.length > QueryParser.MAX_TERMS) throw new SearchError('INVALID_QUERY', `at most ${QueryParser.MAX_TERMS} terms`);
    if (!positive.length) return { match: '', terms: [] };
    return { match: [positive.join(' AND '), ...negative.map((n) => `NOT ${n}`)].join(' '), terms };
  }
}
