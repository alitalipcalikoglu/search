import { SearchService } from '../domain/search-service.js';

/** @typedef {import('../types.js').IndexRow} IndexRow */

/** Response shapes. */
export class Views {
  /** @param {number|null} t */
  static iso(t) {
    return t === null ? null : new Date(Number(t)).toISOString();
  }

  /**
   * @param {IndexRow} i
   * @param {{ documents: number, lastIndexedAt: number }} [stats]
   * @param {number} [searches]
   */
  static index(i, stats, searches = 0) {
    return {
      name: i.name, description: i.description, weights: JSON.parse(i.weights), facets: /** @type {string[]} */ (JSON.parse(i.facets)),
      documents: stats?.documents ?? 0, lastIndexedAt: stats ? Views.iso(stats.lastIndexedAt) : null, searchesSinceStart: searches,
      createdBy: i.created_by, createdAt: Views.iso(i.created_at), updatedAt: Views.iso(i.updated_at),
    };
  }

  static document = SearchService.view;
}
