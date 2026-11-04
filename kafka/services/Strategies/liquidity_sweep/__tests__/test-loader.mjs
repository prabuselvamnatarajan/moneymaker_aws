import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.join(__dirname, 'mocks');
const strategyPkgUrl = pathToFileURL(path.join(__dirname, '..', 'package.json')).href;
const repoRoot = path.resolve(__dirname, '../../../../../');
const sharedStrategyDir = path.join(repoRoot, 'shared', 'strategy');
const sharedRedisOps = path.join(repoRoot, 'shared', 'redis_operations', 'index.js');
const sharedLatencyUtil = path.join(repoRoot, 'shared', 'utils', 'latencyUtil.js');

export async function resolve(specifier, context, nextResolve) {
    // Shared strategy modules live outside this package; resolve their bare deps from here.
    if (specifier === 'kafkajs' || specifier === 'redis') {
        return nextResolve(specifier, { ...context, parentURL: strategyPkgUrl });
    }
    if (specifier === '/app/utils/logUtils.js') {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'logUtils.js')).href,
        };
    }
    if (specifier === '/app/utils/latencyUtil.js') {
        return {
            shortCircuit: true,
            url: pathToFileURL(sharedLatencyUtil).href,
        };
    }
    if (specifier === '/app/utils/kafkaErrorHandler.js') {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'kafkaErrorHandler.js')).href,
        };
    }
    if (specifier === 'axios') {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'axios.js')).href,
        };
    }
    if (
        specifier === '/app/redis_utils/account_utils.js'
        || specifier.endsWith('/redis_utils/account_utils.js')
        || specifier === './redis_utils/account_utils.js'
        || specifier === '../redis_utils/account_utils.js'
    ) {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'account_utils.js')).href,
        };
    }
    if (
        specifier === '/app/redis_utils/redis_operations/index.js'
        || specifier.endsWith('/redis_utils/redis_operations/index.js')
        || specifier === './redis_operations/index.js'
        || specifier.endsWith('/redis_operations/index.js')
    ) {
        return {
            shortCircuit: true,
            url: pathToFileURL(sharedRedisOps).href,
        };
    }
    if (specifier.startsWith('/app/strategy/')) {
        const rel = specifier.slice('/app/strategy/'.length);
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(sharedStrategyDir, rel)).href,
        };
    }
    return nextResolve(specifier, context);
}
