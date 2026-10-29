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
    const escapedSearch = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, "i");
    filter.$or = searchFields.map((field) => ({ [field]: searchRegex }));
  }

  return { filter, skip, limit, sort, page };
}

export function getProjectionFields(fieldsParam) {
  if (!fieldsParam) return undefined;
  const fields = fieldsParam.split(",");
  const dbFieldsSet = new Set([
    "_id", 
    "user_id", 
    "description", 
    "change_in_balance", 
    "opening_balance", 
    "closing_balance", 
    "transaction_type",
    "created_at",
    "created_on",
    "execution_time"
  ]);

  const mapUIFieldToDBFields = {
    timestamp: ["created_at", "created_on", "execution_time"],
    type: ["type_of_order", "transaction_type", "order_type"],
    symbol: ["symbol"],
    strategy: ["deployment_id", "strategy_id"],
    account: ["account_id"],
    quantity: ["quantity", "trade_id"],
    price: ["price", "trade_id"],
    fee: ["commission", "trade_id"],
    status: ["status"],
    tradeId: ["trade_id"]
  };

  fields.forEach(field => {
    const dbFields = mapUIFieldToDBFields[field];
    if (dbFields) {
      dbFields.forEach(dbField => dbFieldsSet.add(dbField));
    }
  });

  return Array.from(dbFieldsSet).join(" ");
}
