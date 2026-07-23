export const store = {
    balance: 100000,
    bought: {},
    short: {},
    orderFail: false,
    orders: [],
};

export function resetStore(overrides = {}) {
    store.balance = overrides.balance ?? 100000;
    store.bought = overrides.bought ?? {};
    store.short = overrides.short ?? {};
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

export async function getShortQuantityWithTagFromRedis(tag, deploymentId) {
    const key = deploymentId ? `${deploymentId}:${tag}` : tag;
    return store.short[key] || 0;
}

export async function setShortQuantityWithTagToRedis(tag, quantity, deploymentId) {
    const key = deploymentId ? `${deploymentId}:${tag}` : tag;
    store.short[key] = quantity;
}
