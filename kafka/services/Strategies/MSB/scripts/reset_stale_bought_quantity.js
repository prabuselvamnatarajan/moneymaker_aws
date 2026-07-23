#!/usr/bin/env node
/**
 * One-time production recovery for MSB stale holdings.
 *
 * After the 1-BUY / many-SELL bug, Redis may still hold a non-zero
 * bought_quantity even though the position was oversold. Reset it before
 * redeploying the fixed strategy containers.
 *
 * Usage:
 *   REDIS_URL=redis://... node reset_stale_bought_quantity.js <deploymentId> <symbol>
 *
 * Example:
 *   REDIS_URL=redis://localhost:6379 node reset_stale_bought_quantity.js \
 *     664f1a2b3c4d5e6f7a8b9c0d 'NSE_EQ|INE002A01018'
 *
 * Also verify account_balance:{account_id} matches broker / BackTestApp.
 * Optional: inspect strategies:msb:live:{deploymentId}:{symbol} if isUp looks wrong.
 */
import { createClient } from 'redis';

const [deploymentId, symbol] = process.argv.slice(2);

if (!deploymentId || !symbol) {
    console.error('Usage: node reset_stale_bought_quantity.js <deploymentId> <symbol>');
    process.exit(1);
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const key = `bought_quantity:${deploymentId}:${symbol}`;

async function main() {
    const client = createClient({ url: redisUrl });
    client.on('error', (err) => console.error('Redis error:', err.message));
    await client.connect();

    let previous = null;
    try {
        // RedisJSON path used by account_utils.setJson
        previous = await client.json.get(key);
    } catch {
        // Fallback for plain string/JSON values
        const raw = await client.get(key);
        previous = raw;
    }

    console.log(`Key: ${key}`);
    console.log(`Previous value: ${JSON.stringify(previous)}`);

    await client.json.set(key, '$', { quantity: 0 });
    const after = await client.json.get(key);
    console.log(`Reset to: ${JSON.stringify(after)}`);
    console.log('Done. Redeploy msb-strategy / msb-pts-strategy after this reset.');

    await client.quit();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
