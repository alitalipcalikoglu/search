/** JSON Schemas for the HTTP surface. Document contents are validated in the domain layer. */
export class Schemas {
  static name = { type: 'string', pattern: '^[a-z0-9]+([.\\-_][a-z0-9]+)*$', maxLength: 80 };
  static docId = { type: 'string', minLength: 1, maxLength: 200 };
  static description = { type: 'string', maxLength: 500 };
  static weights = { type: 'object', additionalProperties: false, properties: { title: { type: 'number' }, body: { type: 'number' }, tags: { type: 'number' } } };
  static facets = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 64 } };
  static limit = { type: 'string', pattern: '^([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|1000)$' };
  static offset = { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' };
  static sort = { type: 'string', enum: ['relevance', 'newest', 'oldest'] };

  /**
   * @param {string[]} required
   * @param {Record<string, object>} properties
   */
  static body(required, properties) {
    return { type: 'object', additionalProperties: false, required, properties };
  }

  static createIndex = Schemas.body(['name'], { name: Schemas.name, description: Schemas.description, weights: Schemas.weights, facets: Schemas.facets });
  static patchIndex = { type: 'object', additionalProperties: false, minProperties: 1, properties: { description: Schemas.description, weights: Schemas.weights, facets: Schemas.facets } };
  static upsert = Schemas.body(['documents'], { documents: { type: 'array', minItems: 1, maxItems: 10_000, items: { type: 'object', required: ['id', 'title'], properties: { id: Schemas.docId, title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 100 } }, attrs: { type: 'object' }, url: { type: 'string', maxLength: 2048 } }, additionalProperties: false } } });
  static searchBody = Schemas.body([], {
    q: { type: 'string', maxLength: 500 }, filters: { type: 'object', maxProperties: 20, additionalProperties: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 200 } } },
    facets: Schemas.facets, limit: { type: 'integer', minimum: 1, maximum: 1000 }, offset: { type: 'integer', minimum: 0 }, highlight: { type: 'boolean' }, sort: Schemas.sort,
  });

  static nameParams = { type: 'object', properties: { name: Schemas.name }, required: ['name'] };
  static docParams = { type: 'object', properties: { name: Schemas.name, id: Schemas.docId }, required: ['name', 'id'] };
  /** GET form: `?q=&limit=&offset=&highlight=true&facets=a,b&sort=&filter.<key>=v1,v2`. */
  static searchQuery = {
    type: 'object', additionalProperties: { type: 'string', maxLength: 2000 },
    properties: { q: { type: 'string', maxLength: 500 }, limit: Schemas.limit, offset: Schemas.offset, highlight: { type: 'string', enum: ['true', 'false'] }, facets: { type: 'string', maxLength: 1000 }, sort: Schemas.sort },
  };
  static suggestQuery = { type: 'object', additionalProperties: false, required: ['q'], properties: { q: { type: 'string', minLength: 1, maxLength: 200 }, limit: Schemas.limit } };
  static browseQuery = { type: 'object', additionalProperties: false, properties: { limit: Schemas.limit, offset: Schemas.offset } };
}
