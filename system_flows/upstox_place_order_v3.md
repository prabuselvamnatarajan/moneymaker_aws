# Upstox Place Order V3: Payload Reference

This is the body `placeorder` sends to Upstox when a LIVE deployment places an order.
The code that builds it is `buildBrokerOrderPayload()` in
`MicroServices/Orders/placeOrders/dependency.js`. Keep the two in step: if Upstox adds or
changes a field, update the table below and the allowlist in that function together.

- **Source:** [Upstox Place Order V3](https://upstox.com/developer/api-documentation/v3/place-order)
- **Last checked:** 2026-11-28

## Endpoint

```
POST https://api-hft.upstox.com/v3/order/place
Content-Type: application/json
Accept: application/json
Authorization: Bearer <access_token>
```

- There are no query parameters.
- `X-Algo-Name` is an optional header. Upstox says it is "only required if you have an exchange-approved algo strategy". We don't send it.
- V2 (`/v2/order/place`) is deprecated. It has the same fields except `slice`, and returns a single `order_id`.

## Request body

| Field | Required | Type | Allowed values / rule | What `placeorder` sends |
|---|---|---|---|---|
| `quantity` | Yes | int32 | Units for equity and F&O; lots for commodity | Positive integer, otherwise 400 |
| `product` | Yes | string | `I`, `D`, `MTF` | Uppercased and validated |
| `validity` | Yes | string | `DAY`, `IOC` | Uppercased and validated |
| `price` | Yes | float | Order price | `0` for `MARKET` / `SL-M`; must be > 0 for `LIMIT` / `SL` |
| `instrument_token` | Yes | string | Instrument key, e.g. `NSE_FO\|43919` | Trimmed and must not be empty |
| `order_type` | Yes | string | `MARKET`, `LIMIT`, `SL`, `SL-M` | Uppercased and validated |
| `transaction_type` | Yes | string | `BUY`, `SELL` | Uppercased and validated |
| `disclosed_quantity` | Yes | int32 | Quantity shown in market depth | Integer from 0 to `quantity` (default 0) |
| `trigger_price` | Yes | float | Stop-loss trigger | Must be > 0 for `SL` / `SL-M`; `0` otherwise |
| `is_amo` | No | boolean | After-market order flag. Upstox ignores it and infers it from the market session. | `true` only for `true` / `"true"` |
| `slice` | No | boolean | Auto-split above the freeze quantity (default `false`) | `true` only for `true` / `"true"` |
| `tag` | No | string | Free text; retrievable via Order History. No documented length limit. | Sent when not empty (the sanitized symbol) |
| `market_protection` | No | int32 | `-1` auto (default), `1`–`25` percent, `0` none. With `0`, Upstox rejects MARKET orders. | **Not sent**, so Upstox applies `-1` |

**Never sent:** `strategy_details`, `client_order_id`, `ltp`, `Symbol_Name`, latency data, or any other internal field.

## Response (200)

```json
{
  "status": "success",
  "data": { "order_ids": ["1644490272000", "1644490272001"] },
  "metadata": { "latency": 30 }
}
```

- `data.order_ids` is an array with one id per slice.
- `placeorder` treats any `status` other than `"success"` as a rejection.
- Upstox doesn't document an error body shape for 4XX responses.

## Things Upstox does not provide

- **No idempotency key.** Upstox has no client order id or dedup header, so a retried request places a second order. `client_order_id` only dedupes our own ledger.
- The docs don't say whether Upstox rejects unknown body fields. We avoid the question by sending only the fields above.
