import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _axios;
async function getAxios() {
    if (!_axios) {
        try {
            const mod = await import('axios');
            _axios = mod.default || mod;
        } catch {
            _axios = null;
        }
    }
    return _axios;
}

const accountUtilsCandidates = [
    '/app/redis_utils/account_utils.js',
    path.resolve(__dirname, '../Accounts/account_utils.js'),
    path.resolve(__dirname, '../../Accounts/account_utils.js'),
    path.resolve(__dirname, './account_utils.js'),
];
const accountUtilsPath = accountUtilsCandidates.find(p => existsSync(p));
const {
    getAccountBalanceFromRedis,
    getBoughtQuantityWithTagFromRedis,
    acquireOrderLockInRedis,
    releaseOrderLockInRedis,
} = accountUtilsPath
    ? await import(pathToFileURL(accountUtilsPath).href)
    : {
        getAccountBalanceFromRedis: async () => 0,
        getBoughtQuantityWithTagFromRedis: async () => 0,
        acquireOrderLockInRedis: async () => true,
        releaseOrderLockInRedis: async () => {},
    };

const logUtilsCandidates = [
    '/app/utils/logUtils.js',
    path.resolve(__dirname, '../utils/logUtils.js'),
    path.resolve(__dirname, '../../utils/logUtils.js'),
    path.resolve(__dirname, './utils/logUtils.js'),
];
const logUtilsPath = logUtilsCandidates.find(p => existsSync(p));
const { logger } = logUtilsPath
    ? await import(pathToFileURL(logUtilsPath).href)
    : {
        logger: {
            info: console.log,
            warn: console.warn,
            error: console.error,
            debug: () => {},
        },
    };

export function sanitizeTag(tag) {
    return tag ? tag.replace(/[^a-zA-Z0-9_-]/g, '_') : 'symbol';
}

export function buildClientOrderId(deploymentId, tag, transactionType, timestamp) {
    const cleanTag = sanitizeTag(tag);
    const tsMs = timestamp ? new Date(timestamp).getTime() : Date.now();
    return `${deploymentId || 'manual'}_${cleanTag}_${transactionType}_${tsMs}`;
}

export function computeBuyQuantity({
    use_full_amount,
    balance,
    ltp,
    lot_size,
    no_of_lots = 1,
    default_qty = 1,
    commission_type = 'PERCENTAGE',
    commission_rate = 0,
}) {
    const lot = Number(lot_size) > 0 ? Number(lot_size) : null;
    const lots = Number(no_of_lots) >= 1 ? Math.floor(Number(no_of_lots)) : 1;

    if (use_full_amount) {
        if (balance != null && balance >= 0) {
            let maxAffordableValue = balance;
            if (commission_type === 'FLAT') {
                maxAffordableValue = Math.max(0, balance - commission_rate);
            } else if (commission_type === 'PERCENTAGE') {
                maxAffordableValue = balance / (1 + (commission_rate / 100));
            }
            maxAffordableValue = Math.max(0, maxAffordableValue + 1e-5);

            if (lot) {
                return Math.floor(maxAffordableValue / (ltp * lot)) * lot;
            } else {
                return Math.floor(maxAffordableValue / ltp);
            }
        } else {
            return lot ? (lots * lot) : default_qty;
        }
    } else if (lot) {
        return lots * lot;
    } else {
        return default_qty;
    }
}

/**
 * Shared order body construction.
 * Explicit quantity is used as given. With no quantity:
 * - SELL uses bought quantity only
 * - BUY uses MSB full-balance / lots / fixed-quantity rules (+ 1e-5 before flooring)
 * client_order_id is added only when includeClientOrderId is true.
 */
export async function computeOrderPayload({
    strategyDetails,
    transactionType,
    price: ltp,
    tag,
    timestamp,
    quantity: quantityOverride,
    includeClientOrderId = false,
} = {}) {
    const strategy_details = strategyDetails || {};
    let {
        account_id,
        use_full_amount = false,
        quantity = 1,
        no_of_lots = 1,
        lot_size,
        instrument_token,
        product = 'D',
        validity = 'DAY',
        order_type = 'MARKET',
        is_amo = false,
        slice = true,
        disclosed_quantity = 0,
        trigger_price = 0,
        commission_type = 'PERCENTAGE',
        commission_rate = 0,
    } = strategy_details;

    const isBacktest =
        strategy_details.strategy_mode === 'BACKTEST' || strategy_details.isTest === true;

    if (quantityOverride != null && Number(quantityOverride) >= 0 && Number.isFinite(Number(quantityOverride))) {
        quantity = Number(quantityOverride);
    } else if (transactionType === 'SELL') {
        // Exit long: only sell when Redis holdings exist (never invent qty)
        const boughtQty = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        quantity = boughtQty > 0 ? boughtQty : 0;
    } else if (transactionType === 'BUY') {
        let current_acc_balance = null;
        if (use_full_amount) {
            current_acc_balance = await getAccountBalanceFromRedis(
                account_id,
                strategy_details.deployment_id,
                isBacktest
            );
        }
        quantity = computeBuyQuantity({
            use_full_amount,
            balance: current_acc_balance,
            ltp,
            lot_size,
            no_of_lots,
            default_qty: Number(strategy_details.quantity) > 0 ? Number(strategy_details.quantity) : 1,
            commission_type,
            commission_rate,
        });
    }

    if (timestamp) {
        strategy_details.execution_time = new Date(timestamp).toISOString();
    }

    const cleanTag = sanitizeTag(tag);
    const orderPayLoad = {
        quantity,
        product,
        validity,
        price: ltp,
        tag: cleanTag,
        instrument_token,
        order_type,
        transaction_type: transactionType,
        disclosed_quantity: Number(disclosed_quantity),
        trigger_price: Number(trigger_price),
        is_amo: String(is_amo) === 'true',
        slice: String(slice) === 'true',
        strategy_details,
    };

    if (includeClientOrderId) {
        orderPayLoad.client_order_id = buildClientOrderId(
            strategy_details.deployment_id,
            cleanTag,
            transactionType,
            timestamp
        );
    }

    return orderPayLoad;
}

export async function placeOrderHttp(requestBody, retries = 1) {
    if (!requestBody || requestBody.quantity <= 0) {
        logger.warn('Order quantity is zero or negative, skipping order trigger.');
        return false;
    }
    const placeOrderApi = process.env.PLACEORDER_API;
    if (!placeOrderApi) {
        logger.error('PLACEORDER_API env variable not set');
        return false;
    }
    const axiosClient = await getAxios();
    const attempts = Math.max(1, Number(retries) || 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            if (axiosClient) {
                const res = await axiosClient.post(placeOrderApi, requestBody);
                if (res.status >= 200 && res.status < 300) {
                    logger.debug('Order API response:', res.data);
                    return true;
                }
                logger.error(`Order API non-success status on attempt ${attempt}: ${res.status}`);
            } else {
                const res = await fetch(placeOrderApi, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                });
                if (res.ok) {
                    return true;
                }
                logger.error(`Order API non-success status on attempt ${attempt}: ${res.status}`);
            }
        } catch (err) {
            logger.error(`Order API error on attempt ${attempt}/${attempts}: ${err.message}`);
        }
        if (attempt < attempts) {
            await new Promise((res) => setTimeout(res, 50 * attempt));
        }
    }
    return false;
}

export async function executeOrderWithLock(symbol, deploymentId, orderFn) {
    const lockAcquired = await acquireOrderLockInRedis(symbol, deploymentId);
    if (!lockAcquired) {
        logger.warn(
            `Order placement already in-flight for ${symbol} (deployment: ${deploymentId}). Skipping duplicate tick trigger.`
        );
        return false;
    }
    try {
        return await orderFn();
    } finally {
        await releaseOrderLockInRedis(symbol, deploymentId);
    }
}
