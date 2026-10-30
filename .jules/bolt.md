## 2024-05-24 - Missing .lean() in Mongoose Queries
**Learning:** Found multiple instances where read-only Mongoose queries did not use `.lean()`. This is a significant performance bottleneck because Mongoose hydrates plain objects into full Mongoose documents, increasing memory usage and CPU time.
**Action:** Always append `.lean()` to read-only Mongoose queries to return plain JavaScript objects and improve performance.
