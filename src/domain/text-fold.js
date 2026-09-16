/**
 * Text folding used for both indexing and matching: lower-case, diacritics removed, Turkish
 * dotted/dotless i unified. Applied in JavaScript because SQLite's unicode61 tokenizer does not
 * fold "ı" and "İ", which makes "kirmizi" miss "Kırmızı".
 */
export class TextFold {
  /** @param {string} text */
  static fold(text) {
    return text.normalize('NFD').replace(/\p{M}+/gu, '').replace(/ı/g, 'i').replace(/I/g, 'i').toLowerCase();
  }

  /**
   * Tokens of a text as `{ text, start, end }`, letters and digits only, in document order.
   * @param {string} text
   */
  static tokens(text) {
    /** @type {{ text: string, start: number, end: number }[]} */
    const out = [];
    for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
}
