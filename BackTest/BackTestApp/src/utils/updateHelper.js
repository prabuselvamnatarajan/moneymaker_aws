export function pickAllowedFields(data, allowedFields) {
  const update = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }
  return update;
}
