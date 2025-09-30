
// Simple Express mock server for development (ESM syntax)
import express from 'express';
import cors from 'cors';
const app = express();
const PORT = 8080;

app.use(cors());
// Backtest accounts endpoint
app.get('/client/backtest/accounts', (req, res) => {
  res.json({
    accounts: [
      {
        account_id: 1,
        account_name: 'Demo Backtest Account',
        money: 100000,
        account_owner: 'John Doe',
        created_at: '2025-07-01',
        active_strategies: [
          { strategy_id: 1, strategy_name: 'Sample Strategy 1' },
          { strategy_id: 4, strategy_name: 'Momentum Hunter' }
        ]
      }
    ]
  });
});

// Transactions endpoint
app.get('/client/transactions', (req, res) => {
  res.json({
    transactions: [
      {
        transaction_id: 101,
        date: '2025-08-01',
        type: 'BUY',
        amount: 5000,
        strategy: 'Sample Strategy 1',
        status: 'Completed'
      },
      {
        transaction_id: 102,
        date: '2025-08-02',
        type: 'SELL',
        amount: 3000,
        strategy: 'Momentum Hunter',
        status: 'Completed'
      },
      {
        transaction_id: 103,
        date: '2025-08-03',
        type: 'BUY',
        amount: 2000,
        strategy: 'Sample Strategy 1',
        status: 'Pending'
      },
      {
        transaction_id: 104,
        date: '2025-08-04',
        type: 'SELL',
        amount: 1500,
        strategy: 'Mean Reversion',
        status: 'Completed'
      },
      {
        transaction_id: 105,
        date: '2025-08-05',
        type: 'BUY',
        amount: 2500,
        strategy: 'Breakout Trader',
        status: 'Completed'
      },
      {
        transaction_id: 106,
        date: '2025-08-06',
        type: 'SELL',
        amount: 1800,
        strategy: 'Scalper',
        status: 'Completed'
      },
      {
        transaction_id: 107,
        date: '2025-08-07',
        type: 'BUY',
        amount: 3200,
        strategy: 'Swing Trader',
        status: 'Pending'
      },
      {
        transaction_id: 108,
        date: '2025-08-08',
        type: 'SELL',
        amount: 2100,
        strategy: 'Volatility Squeezer',
        status: 'Completed'
      },
      {
        transaction_id: 109,
        date: '2025-08-09',
        type: 'BUY',
        amount: 4000,
        strategy: 'Momentum Hunter',
        status: 'Completed'
      },
      {
        transaction_id: 110,
        date: '2025-08-10',
        type: 'SELL',
        amount: 3500,
        strategy: 'Sample Strategy 1',
        status: 'Pending'
      },
      {
        transaction_id: 111,
        date: '2025-08-11',
        type: 'BUY',
        amount: 4200,
        strategy: 'Breakout Trader',
        status: 'Completed'
      },
      {
        transaction_id: 112,
        date: '2025-08-12',
        type: 'SELL',
        amount: 2700,
        strategy: 'Swing Trader',
        status: 'Completed'
      },
      {
        transaction_id: 113,
        date: '2025-08-13',
        type: 'BUY',
        amount: 3900,
        strategy: 'Momentum Hunter',
        status: 'Pending'
      },
      {
        transaction_id: 114,
        date: '2025-08-14',
        type: 'SELL',
        amount: 3100,
        strategy: 'Mean Reversion',
        status: 'Completed'
      },
      {
        transaction_id: 115,
        date: '2025-08-15',
        type: 'BUY',
        amount: 2500,
        strategy: 'Scalper',
        status: 'Completed'
      },
      {
        transaction_id: 116,
        date: '2025-08-16',
        type: 'SELL',
        amount: 3300,
        strategy: 'Volatility Squeezer',
        status: 'Pending'
      },
      {
        transaction_id: 117,
        date: '2025-08-17',
        type: 'BUY',
        amount: 4600,
        strategy: 'Sample Strategy 1',
        status: 'Completed'
      },
      {
        transaction_id: 118,
        date: '2025-08-18',
        type: 'SELL',
        amount: 2100,
        strategy: 'Breakout Trader',
        status: 'Completed'
      },
      {
        transaction_id: 119,
        date: '2025-08-19',
        type: 'BUY',
        amount: 3700,
        strategy: 'Swing Trader',
        status: 'Pending'
      },
      {
        transaction_id: 120,
        date: '2025-08-20',
        type: 'SELL',
        amount: 2900,
        strategy: 'Momentum Hunter',
        status: 'Completed'
      }
    ]
  });
});

app.get('/client/account', (req, res) => {
  res.json({
    firstname: 'John',
    lastname: 'Doe',
    dob: '1990-01-01',
    email: 'john.doe@example.com',
    username: 'johndoe',
    password: '********',
    strategies: {
      total: 3,
      active: 2,
      inactive: 1
    }
  });
});

app.get('/client/strategies', (req, res) => {
  res.json({
    strategies: [
      {
        strategy_id: 1,
        strategy_name: 'Sample Strategy 1',
        description: 'A sample strategy for development.',
        script: `// Example strategy logic\nfunction runStrategy() {\n  console.log('Strategy 1 running');\n  // Add your trading logic here\n}\nrunStrategy();`,
        created_at: '2025-08-01',
        last_modified_at: '2025-08-05',
        created_by: 'user1',
        last_modified_by: 'user2',
        is_active: true,
      },
      {
        strategy_id: 2,
        strategy_name: 'Inactive Strategy',
        description: 'This strategy is inactive.',
        script: `// Inactive strategy example\nfunction runInactive() {\n  // This strategy is currently inactive\n  return false;\n}`,
        created_at: '2025-07-15',
        last_modified_at: '2025-07-20',
        created_by: 'user3',
        last_modified_by: 'user3',
        is_active: false,
      },
      {
        strategy_id: 3,
        strategy_name: 'Active Strategy 2',
        description: 'Another active strategy.',
        script: `// Another active strategy\nfunction runStrategy2() {\n  console.log('Strategy 2 running');\n  // More trading logic\n}\nrunStrategy2();`,
        created_at: '2025-08-02',
        last_modified_at: '2025-08-06',
        created_by: 'user2',
        last_modified_by: 'user1',
        is_active: true,
      },
      {
        strategy_id: 4,
        strategy_name: 'Momentum Hunter',
        description: 'Detects and trades on strong price momentum.',
        script: `// Momentum Hunter\nfunction momentumHunter(prices) {\n  if (prices.slice(-3).every((v, i, arr) => i === 0 || v > arr[i-1])) {\n    return 'BUY';\n  }\n  return 'HOLD';\n}`,
        created_at: '2025-08-03',
        last_modified_at: '2025-08-07',
        created_by: 'user4',
        last_modified_by: 'user4',
        is_active: true,
      },
      {
        strategy_id: 5,
        strategy_name: 'Mean Reversion',
        description: 'Buys when price deviates below mean, sells above.',
        script: `// Mean Reversion\nfunction meanReversion(price, mean) {\n  if (price < mean * 0.97) return 'BUY';\n  if (price > mean * 1.03) return 'SELL';\n  return 'HOLD';\n}`,
        created_at: '2025-08-04',
        last_modified_at: '2025-08-08',
        created_by: 'user5',
        last_modified_by: 'user5',
        is_active: false,
      },
      {
        strategy_id: 6,
        strategy_name: 'Breakout Trader',
        description: 'Enters trades on price breakouts from range.',
        script: `// Breakout Trader\nfunction breakoutTrader(price, high, low) {\n  if (price > high) return 'BUY';\n  if (price < low) return 'SELL';\n  return 'WAIT';\n}`,
        created_at: '2025-08-05',
        last_modified_at: '2025-08-09',
        created_by: 'user6',
        last_modified_by: 'user6',
        is_active: true,
      },
      {
        strategy_id: 7,
        strategy_name: 'Scalper',
        description: 'Executes quick trades for small profits.',
        script: `// Scalper\nfunction scalper(tick) {\n  if (tick.spread < 0.02) return 'SCALP';\n  return 'WAIT';\n}`,
        created_at: '2025-08-06',
        last_modified_at: '2025-08-10',
        created_by: 'user7',
        last_modified_by: 'user7',
        is_active: false,
      },
      {
        strategy_id: 8,
        strategy_name: 'Swing Trader',
        description: 'Captures short- to medium-term price swings.',
        script: `// Swing Trader\nfunction swingTrader(trend) {\n  if (trend === 'up') return 'BUY';\n  if (trend === 'down') return 'SELL';\n  return 'HOLD';\n}`,
        created_at: '2025-08-07',
        last_modified_at: '2025-08-11',
        created_by: 'user8',
        last_modified_by: 'user8',
        is_active: true,
      },
      {
        strategy_id: 9,
        strategy_name: 'Volatility Squeezer',
        description: 'Trades on volatility contraction and expansion.',
        script: `// Volatility Squeezer\nfunction volatilitySqueezer(volatility) {\n  if (volatility < 0.5) return 'PREPARE';\n  if (volatility > 1.5) return 'TRADE';\n  return 'WAIT';\n}`,
        created_at: '2025-08-08',
        last_modified_at: '2025-08-12',
        created_by: 'user9',
        last_modified_by: 'user9',
        is_active: false,
      },
      {
        strategy_id: 10,
        strategy_name: 'Active Strategy 2',
        description: 'Another active strategy.',
        script: `// Another active strategy\nfunction runStrategy2() {\n  console.log('Strategy 2 running');\n  // More trading logic\n}\nrunStrategy2();`,
        created_at: '2025-08-02',
        last_modified_at: '2025-08-06',
        created_by: 'user2',
        last_modified_by: 'user1',
        is_active: true,
      },
      {
        strategy_id: 11,
        strategy_name: 'Momentum Hunter',
        description: 'Detects and trades on strong price momentum.',
        script: `// Momentum Hunter\nfunction momentumHunter(prices) {\n  if (prices.slice(-3).every((v, i, arr) => i === 0 || v > arr[i-1])) {\n    return 'BUY';\n  }\n  return 'HOLD';\n}`,
        created_at: '2025-08-03',
        last_modified_at: '2025-08-07',
        created_by: 'user4',
        last_modified_by: 'user4',
        is_active: true,
      },
      {
        strategy_id: 12,
        strategy_name: 'Mean Reversion',
        description: 'Buys when price deviates below mean, sells above.',
        script: `// Mean Reversion\nfunction meanReversion(price, mean) {\n  if (price < mean * 0.97) return 'BUY';\n  if (price > mean * 1.03) return 'SELL';\n  return 'HOLD';\n}`,
        created_at: '2025-08-04',
        last_modified_at: '2025-08-08',
        created_by: 'user5',
        last_modified_by: 'user5',
        is_active: false,
      },
      {
        strategy_id: 13,
        strategy_name: 'Breakout Trader',
        description: 'Enters trades on price breakouts from range.',
        script: `// Breakout Trader\nfunction breakoutTrader(price, high, low) {\n  if (price > high) return 'BUY';\n  if (price < low) return 'SELL';\n  return 'WAIT';\n}`,
        created_at: '2025-08-05',
        last_modified_at: '2025-08-09',
        created_by: 'user6',
        last_modified_by: 'user6',
        is_active: true,
      },
      {
        strategy_id: 14,
        strategy_name: 'Scalper',
        description: 'Executes quick trades for small profits.',
        script: `// Scalper\nfunction scalper(tick) {\n  if (tick.spread < 0.02) return 'SCALP';\n  return 'WAIT';\n}`,
        created_at: '2025-08-06',
        last_modified_at: '2025-08-10',
        created_by: 'user7',
        last_modified_by: 'user7',
        is_active: false,
      },
      {
        strategy_id: 15,
        strategy_name: 'Swing Trader',
        description: 'Captures short- to medium-term price swings.',
        script: `// Swing Trader\nfunction swingTrader(trend) {\n  if (trend === 'up') return 'BUY';\n  if (trend === 'down') return 'SELL';\n  return 'HOLD';\n}`,
        created_at: '2025-08-07',
        last_modified_at: '2025-08-11',
        created_by: 'user8',
        last_modified_by: 'user8',
        is_active: true,
      },
      {
        strategy_id: 16,
        strategy_name: 'Volatility Squeezer',
        description: 'Trades on volatility contraction and expansion.',
        script: `// Volatility Squeezer\nfunction volatilitySqueezer(volatility) {\n  if (volatility < 0.5) return 'PREPARE';\n  if (volatility > 1.5) return 'TRADE';\n  return 'WAIT';\n}`,
        created_at: '2025-08-08',
        last_modified_at: '2025-08-12',
        created_by: 'user9',
        last_modified_by: 'user9',
        is_active: false,
      },
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Mock server running at http://localhost:${PORT}`);
});
