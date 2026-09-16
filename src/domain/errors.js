/**
 * Domain error with a stable machine-readable code and the HTTP status the API maps it to.
 */
export class SearchError extends Error {
  /** @type {Record<string, number>} */
  static STATUS = {
    INDEX_NOT_FOUND: 404,
    INDEX_EXISTS: 409,
    DOCUMENT_NOT_FOUND: 404,
    INVALID_DOCUMENT: 400,
    INVALID_QUERY: 400,
    BATCH_TOO_LARGE: 413,
    DOCUMENT_TOO_LARGE: 413,
    INVALID_CURSOR: 400,
    FORBIDDEN: 403,
  };

  /**
   * @param {keyof typeof SearchError.STATUS} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.statusCode = SearchError.STATUS[code];
    this.details = details;
  }
}
