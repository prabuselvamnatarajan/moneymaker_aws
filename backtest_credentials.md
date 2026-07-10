# Backtest Application Credentials & Seed Data

This document contains the credentials and seed data structure for the `BacktestApp` service database to facilitate development, testing, and future AI assistance.

## User Credentials

| Role | Username | Email | Password | Name |
| --- | --- | --- | --- | --- |
| **Admin** | `admin` | `admin@moneymaker.com` | `adminpassword123` | Admin User |
| **Standard User** | `standarduser` | `user@moneymaker.com` | `userpassword123` | Standard User |

---

## Seeded Database Records (Clean State)

### 1. Accounts

#### Standard User (`standarduser`)
- **simulation** (Type: `SIMULATION`, Initial Balance: `$100,000`, Current Balance: `$100,500`)
- **Test 1** (Type: `PAPER`, Initial Balance: `$50,000`, Current Balance: `$50,000`)

#### Admin User (`admin`)
- **Admin Live** (Type: `LIVE`, Initial Balance: `$250,000`, Current Balance: `$250,000`)
- **Admin Paper** (Type: `PAPER`, Initial Balance: `$75,000`, Current Balance: `$75,000`)

### 2. Strategies

#### Standard User (`standarduser`)
- **Mean Reversion v4**: Detects overbought/oversold levels and enters counter-trend positions.
- **Momentum Scalper**: Scalps quick breakouts along the primary trend direction.
- **Grid Bot Alpha**: Maintains a grid of buy/sell orders around a stable price pivot.

#### Admin User (`admin`)
- **Arbitrage HFT**: High-frequency triangular arbitrage scanner.
- **Breakout Rider**: Rides large macro breakout trends.

### 3. Watchlisted Symbols

- **Standard User**: `BTC/USD` (Token: `BTC-USD`), `AAPL` (Token: `AAPL`), `EUR/USD` (Token: `EUR-USD`), `TSLA` (Token: `TSLA`)
- **Admin User**: `BTC/USD` (Token: `BTC-USD`), `AAPL` (Token: `AAPL`)

### 4. Deployments (Standard User)

- **Mean Reversion v4 (live)**: Running on `simulation` account for symbol `BTC/USD`. Status: `RUNNING`, Mode: `TEST`.
- **Momentum Scalper (live)**: Running on `simulation` account for symbol `AAPL`. Status: `RUNNING`, Mode: `TEST`.
- **Grid Bot Alpha**: Running on `Test 1` account for symbol `EUR/USD`. Status: `PAUSED`, Mode: `TEST`.

### 5. Yield History & Trades (Standard User)

- **Trade 1**: `BUY` 10 `BTC/USD` @ `$100` (executed 2 hours ago)
- **Trade 2**: `SELL` 10 `BTC/USD` @ `$150` (executed 1 hour ago)
- **Ledger Entries**:
  - Buy transaction: balance reduced to `$99,000`
  - Sell transaction: balance increased to `$100,500` (yielding a `$500` profit)

---

## Infrastructure Access

- **Backtest UI Web Console:** [http://localhost/backtest-ui/](http://localhost/backtest-ui/)
- **Mongo Express DB Inspector:** [http://localhost:8081/](http://localhost:8081/)
- **MongoDB Replica Set URI:** `mongodb://root:example@localhost:27017,localhost:27018,localhost:27019/BacktestApp?replicaSet=rs0&authSource=admin`
