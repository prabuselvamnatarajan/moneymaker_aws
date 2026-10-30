# Log Configuration Example

This file shows an example service configuration for the shared Winston logger (via `logUtils.js`) and how to store the log config JSON in Redis.

---

## ✅ Example service environment variables

These are the environment variables the service should expose (e.g., via Docker Compose):

```yaml
environment:
  SERVICE_NAME: wsdatasplitter
  SERVICE_MODE: live
  REDIS_URL: redis://:myStrongRedisPassword@redis:6379
```

- `SERVICE_NAME` is used to build the Redis key for log config.
- `SERVICE_MODE` is used as part of the Redis key (typically `live` or `backtest`).
- `REDIS_URL` points to your Redis instance.

---

## ✅ Redis key + JSON value for log config

### Redis key format

```
<mode>:logs:config:<serviceName>
```

### Example key (for the example service above)

```
live:logs:config:wsdatasplitter
```

### Example Redis value (JSON)

The only required field today is `level`.

```json
{"level":"debug"}
```

This tells the shared logger to log at the `debug` level (and above). If the key is missing or invalid, the logger defaults to `info`.

---

## ✅ How to set it in Redis

Example using `redis-cli` (with RedisJSON module):

```sh
redis-cli JSON.SET live:logs:config:wsdatasplitter . '{"level":"debug"}'
```

If RedisJSON is not available, you can store plain JSON using regular Redis string commands:

```sh
redis-cli SET live:logs:config:wsdatasplitter '{"level":"debug"}'
```

> Note: The `logUtils.js` implementation expects RedisJSON, but can be extended to support plain JSON strings if needed.
