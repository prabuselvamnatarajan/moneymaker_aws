# Migration of Old `console.*` Logging to Winston Logger

## 📌 Why this change?
The project previously used `console.log` / `console.error` directly in service code (including `wsDataSplitterConsumer.js`). This approach has several limitations:

- No log level control (e.g., debug/info/warn/error)
- No structured format (hard to parse, filter, or ship to log systems)
- No centralized configuration (each file logs differently)
- Hard to change log behaviour at runtime

To enable better observability and consistent logging across microservices, we introduced a shared logger using **Winston** and a Redis-backed configuration source.

---

## ✅ What was changed in the codebase

### 1) Added Winston dependency
In `kafka/services/wsDataSplitterConsumer/package.json` we added:

```json
"winston": "^3.11.0"
```

### 2) Introduced shared log utility
Created/updated `MicroServices/Shared/utils/logUtils.js` to:

- Fetch log config from Redis (key format: `<mode>:logs:config:<serviceName>`)
- Initialize a Winston logger with a level derived from Redis (`debug`, `info`, `warn`, `error`)
- Export a shared `logger` object and an `initLogger()` initializer

### 3) Updated service implementation
In `kafka/services/wsDataSplitterConsumer/wsDataSplitterConsumer.js` we:

- Imported `{ initLogger, logger }` from `logUtils.js`
- Called `await initLogger()` at startup
- Replaced all `console.log()` calls with `logger.info()`
- Replaced all `console.error()` calls with `logger.error()`
- Replaced retry messages with `logger.warn()`

### 4) Docker / environment updates
To support per-service log configuration, we introduced (or plan to introduce) the following environment variables into `docker-compose.yml` (or the service’s runtime settings):

- `SERVICE_NAME`: used to build Redis config key (`<mode>:logs:config:<serviceName>`)
- `SERVICE_MODE`: typically `live` or `backtest` (also part of the Redis key)

Example (in docker-compose):

```yaml
environment:
  SERVICE_NAME: wsdatasplitter
  SERVICE_MODE: live
  REDIS_URL: redis://:myStrongRedisPassword@redis:6379
```

These values are used by `logUtils.js` to locate and apply the correct config.

---

## 🛠️ How to configure log levels at runtime

You can change the log level via Redis by setting a JSON config at the key:

```
<mode>:logs:config:<serviceName>
```

For example:

```
JSON.SET live:logs:config:wsdatasplitter "{\"level\":\"debug\"}"
```

Then restart the service to pick up the new level (current implementation reads config at startup).

---

## ✅ Benefits of this migration

- Consistent logging across services
- Easy log-level changes via Redis
- Structured JSON output (timestamps + fields) for log ingestion
- Future-proofing: can be extended (e.g., file transport, external log systems)

---

## 🧩 Migration Recipe (apply to another service)

1) **Add Winston dependency**

   In that service’s `package.json`:

   ```json
   "dependencies": {
     "winston": "^3.11.0"
   }
   ```

   Then run:

   ```bash
   npm install
   ```

2) **Update the service code**

   - Import the shared logger helpers:
     ```js
     import { initLogger, logger } from '../../MicroServices/Shared/utils/logUtils.js';
     ```
     (Adjust the relative path to match the service location.)

   - Call `await initLogger()` before any other log calls (typically at startup).

   - Replace `console.log(...)` with `logger.info(...)`.
   - Replace `console.error(...)` with `logger.error(...)`.
   - Replace retry/expected warning output with `logger.warn(...)`.
   - Optionally add `logger.debug(...)` for verbose internal state.

3) **Ensure environment variables are set**

   Your service must provide:

   - `SERVICE_NAME` (e.g., `wsdatasplitter`)
   - `SERVICE_MODE` (`live` / `backtest`)
   - `REDIS_URL` (Redis connection string)

   Example docker-compose snippet:

   ```yaml
   environment:
     SERVICE_NAME: wsdatasplitter
     SERVICE_MODE: live
     REDIS_URL: redis://:myStrongRedisPassword@redis:6379
   ```

4) **Configure the log level via Redis**

   Set the Redis key:

   ```
   <mode>:logs:config:<serviceName>
   ```

   Example:

   ```
   JSON.SET live:logs:config:wsdatasplitter "{\"level\":\"debug\"}"
   ```

   Then restart the service (current implementation reads config at startup).

---

## 🔍 Notes / Next Steps

- This migration is focused on `wsDataSplitterConsumer` as the pilot service.
- The same pattern can be applied across other services by using the shared `logUtils.js`.
- Future enhancements could include reloading config dynamically (without restart) and supporting multiple transports (file, remote logging, etc.).
