export function parseQueryParams(query, options = {}) {
  const { defaultSort = "created_at", dateField = "created_at", searchFields = [] } = options;

  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;

  let sort = {};
  if (query.sort && query.sort.includes(":")) {
    const parts = query.sort.split(",");
    parts.forEach(part => {
      const [field, direction] = part.split(":");
      if (/^[a-zA-Z0-9_]+$/.test(field)) {
        let dbField = field;
        if (field === "timestamp" || field === "execution_time") {
          dbField = "created_at";
        }
        sort[dbField] = direction === "asc" ? 1 : -1;
      }
    });
  } else {
    const requestedSort = query.sort || defaultSort;
    const sortField = /^[a-zA-Z0-9_]+$/.test(requestedSort) ? requestedSort : defaultSort;
    const order = query.order === "asc" ? 1 : -1;
    let dbField = sortField;
    if (sortField === "timestamp" || sortField === "execution_time") {
      dbField = "created_at";
    }
    sort[dbField] = order;
  }

  const filter = {};

  if (query.from || query.to) {
    filter[dateField] = {};
    if (query.from) {
      filter[dateField].$gte = new Date(query.from);
    }
    if (query.to) {
      filter[dateField].$lte = new Date(query.to);
    }
  }

  if (query.status) {
    filter.$or = [
      { status: query.status },
      { current_status: query.status.toUpperCase() }
    ];
  }
  if (query.is_active !== undefined) {
    filter.is_active = query.is_active === "true";
  }

  if (query.search && searchFields.length > 0) {
    const searchRegex = new RegExp(query.search, "i");
    filter.$or = searchFields.map((field) => ({ [field]: searchRegex }));
  }

  return { filter, skip, limit, sort, page };
}
