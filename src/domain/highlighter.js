import { TextFold } from './text-fold.js';

/**
 * Marks query terms in original text (not the folded copy), so highlights keep the author's
 * spelling. A snippet is the window around the first hit.
 */
export class Highlighter {
  /**
   * @param {{ text: string, prefix: boolean }[]} terms
   * @param {{ open?: string, close?: string }} [marks]
   */
  constructor(terms, { open = '<mark>', close = '</mark>' } = {}) {
    this.terms = terms;
    this.open = open;
    this.close = close;
  }

  /** @param {string} token Folded token. */
  hit(token) {
    return this.terms.some((t) => (t.prefix ? token.startsWith(t.text) : token === t.text));
  }

  /** @param {string} text */
  mark(text) {
    let out = '';
    let pos = 0;
    for (const tok of TextFold.tokens(text)) {
      if (!this.hit(TextFold.fold(tok.text))) continue;
      out += Highlighter.escape(text.slice(pos, tok.start)) + this.open + Highlighter.escape(tok.text) + this.close;
      pos = tok.end;
    }
    return out + Highlighter.escape(text.slice(pos));
  }

  /**
   * Window of about `size` characters around the first hit (the start of the text when nothing hits).
   * @param {string} text
   * @param {number} [size]
   */
  snippet(text, size = 160) {
    const first = TextFold.tokens(text).find((tok) => this.hit(TextFold.fold(tok.text)));
    let start = 0;
    if (first && first.start > size / 3) start = Math.max(0, text.lastIndexOf(' ', first.start - Math.floor(size / 3)) + 1);
    let end = Math.min(text.length, start + size);
    if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > start + size / 2) end = sp; }
    return `${start > 0 ? '…' : ''}${this.mark(text.slice(start, end))}${end < text.length ? '…' : ''}`;
  }

  /** @param {string} s */
  static escape(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  }
}
