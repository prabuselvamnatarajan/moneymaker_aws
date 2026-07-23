import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.join(__dirname, 'mocks');

export async function resolve(specifier, context, nextResolve) {
    if (specifier === '/app/utils/logUtils.js') {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'logUtils.js')).href,
        };
    }
    if (specifier === 'axios') {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'axios.js')).href,
        };
    }
    if (specifier.endsWith('/redis_utils/account_utils.js') || specifier === './redis_utils/account_utils.js') {
        return {
            shortCircuit: true,
            url: pathToFileURL(path.join(mocksDir, 'account_utils.js')).href,
        };
    }
    return nextResolve(specifier, context);
}
