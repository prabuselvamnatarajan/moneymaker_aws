import mongoose from "mongoose";

/**
 * Common logic to parse pagination, sorting, filtering, and date range logic.
 *
 * @param {Object} query - req.query from Express
 * @param {Object} options
 * @param {string} options.defaultSort - Default sort field (e.g., "created_at")
 * @param {string} options.dateField - The field to apply date filtering on (e.g., "created_at", "created_on")
 * @param {string[]} options.searchFields - Fields to perform text search on
 * @returns {Object} { filter, skip, limit, sort, page }
 */
export function parseQueryParams(query, options = {}) {
  const { defaultSort = "created_at", dateField = "created_at", searchFields = [] } = options;

  let filter = {};

  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 50;
  const skip = (page - 1) * limit;

  let sort = {};
  if (query.sortBy) {
    const parts = query.sortBy.split(":");
    sort[parts[0]] = parts[1] === "desc" ? -1 : 1;
  } else {
    sort[defaultSort] = -1; // Default descending
  }

  // Exact Match Filters (skip common pagination/search/date fields)
  const excludeFields = ["page", "limit", "sortBy", "search", "startDate", "endDate"];
  for (const [key, value] of Object.entries(query)) {
    if (!excludeFields.includes(key)) {
      if (key === "user_id" || key === "broker_id" || key === "deployment_id" || key === "strategy_id") {
        if (mongoose.Types.ObjectId.isValid(value)) {
          filter[key] = value;
        }
      } else {
        filter[key] = value;
      }
    }
  }

  // Date Range Filtering
  if (query.startDate || query.endDate) {
    filter[dateField] = {};
    if (query.startDate) filter[dateField].$gte = new Date(query.startDate);
    if (query.endDate) filter[dateField].$lte = new Date(query.endDate);
  }

  if (query.search && searchFields.length > 0) {
    const escapedSearch = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, "i");
    filter.$or = searchFields.map((field) => ({ [field]: searchRegex }));
  }

  return { filter, skip, limit, sort, page };
}
