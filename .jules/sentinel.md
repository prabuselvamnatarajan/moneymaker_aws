## 2024-05-24 - Unescaped RegExp in Query Builder
**Vulnerability:** Regular Expression Denial of Service (ReDoS) vulnerability in `queryHelper.js`.
**Learning:** `new RegExp(query.search, "i")` was used to build dynamic Mongoose filters without sanitizing the search string from query parameters.
**Prevention:** Always escape user-provided strings before using them in `new RegExp` using `string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
