## 2023-10-31 - Add `.lean()` to read-only queries in polling loops
**Learning:** Found several high-frequency polling loops (e.g., `websocketService.js` every 10s per client, `backtestCompletionWatcher.js` every 2s) that were querying the database without `.lean()`. Mongoose document instantiation is heavy, especially in recurring tasks.
**Action:** Always append `.lean()` to Mongoose `find()` or `findOne()` calls in polling intervals or read-only services where documents aren't modified.
