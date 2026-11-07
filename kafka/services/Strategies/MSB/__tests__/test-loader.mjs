import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.join(__dirname, 'mocks');
const strategyPkgUrl = pathToFileURL(path.join(__dirname, '..', 'package.json')).href;
// Local checkout: __tests__ → package → Strategies → services → kafka → repo root.
// In the Docker image __dirname is /app/__tests__, so this lands on "/" and shared/ is absent —
// fall back to the baked-in /app/... paths in that case.
const repoRoot = path.resolve(__dirname, '../../../../../');
const sharedStrategyDir = path.join(repoRoot, 'shared', 'strategy');
const sharedRedisOps = path.join(repoRoot, 'shared', 'redis_operations', 'index.js');
const sharedLatencyUtil = path.join(repoRoot, 'shared', 'utils', 'latencyUtil.js');

function resolveExisting(...candidates) {
    for (const candidate of candidates) {
        if (candidate && existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

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
        const target = resolveExisting(sharedLatencyUtil, '/app/utils/latencyUtil.js');
        if (target) {
            return { shortCircuit: true, url: pathToFileURL(target).href };
        }
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
        || specifier.endsWith('/account_utils.js')
    ) {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'account_utils.js')).href,
        };
    }
    if (specifier === '/app/redis_utils/redis_operations/index.js') {
        const target = resolveExisting(
            sharedRedisOps,
            '/app/redis_utils/redis_operations/index.js'
        );
        if (target) {
            return { shortCircuit: true, url: pathToFileURL(target).href };
        }
    }
    if (specifier.startsWith('/app/strategy/')) {
        const rel = specifier.slice('/app/strategy/'.length);
        const target = resolveExisting(
            path.join(sharedStrategyDir, rel),
            path.join('/app/strategy', rel)
        );
        if (target) {
            return { shortCircuit: true, url: pathToFileURL(target).href };
        }
        // Let Node report the real missing /app/strategy path.
        return nextResolve(specifier, context);
    }
    return nextResolve(specifier, context);
}
