/** In-memory store shared across MSB tests via mock account_utils. */
export const store = {
    balance: 100000,
    bought: {},
    orderFail: false,
    orders: [],
    lockHeldDuringHoldingsUpdate: null,
};

export function resetStore(overrides = {}) {
    store.balance = overrides.balance ?? 100000;
    store.bought = overrides.bought ?? {};
    store.orderFail = overrides.orderFail ?? false;
    store.orders = [];
    store.lockHeldDuringHoldingsUpdate = null;
}

export async function getAccountBalanceFromRedis() {
    return store.balance;
}

export async function getBoughtQuantityWithTagFromRedis(tag, deploymentId) {
    const key = deploymentId ? `${deploymentId}:${tag}` : tag;
    return store.bought[key] || 0;
}

export async function setBoughtQuantityWithTagToRedis(tag, quantity, deploymentId) {
    const key = deploymentId ? `${deploymentId}:${tag}` : tag;
    store.lockHeldDuringHoldingsUpdate = activeLocks.has(key);
    store.bought[key] = quantity;
}

const activeLocks = new Set();

export async function acquireOrderLockInRedis(tag, deploymentId) {
    const key = deploymentId ? `${deploymentId}:${tag}` : tag;
    if (activeLocks.has(key)) return false;
    activeLocks.add(key);
    return true;
}

export async function releaseOrderLockInRedis(tag, deploymentId) {
    const key = deploymentId ? `${deploymentId}:${tag}` : tag;
    activeLocks.delete(key);
}
