/** In-memory store shared across MSB tests via mock account_utils. */
export const store = {
    balance: 100000,
    bought: {},
    orderFail: false,
    orders: [],
};

export function resetStore(overrides = {}) {
    store.balance = overrides.balance ?? 100000;
    store.bought = overrides.bought ?? {};
    store.orderFail = overrides.orderFail ?? false;
    store.orders = [];
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
    store.bought[key] = quantity;
}
