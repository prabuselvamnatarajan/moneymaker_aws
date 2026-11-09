import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

const placeOrdersPkg = pathToFileURL(path.join(repoRoot, 'MicroServices', 'Orders', 'placeOrders', 'package.json')).href;
const backtestAppPkg = pathToFileURL(path.join(repoRoot, 'BackTest', 'BackTestApp', 'package.json')).href;

export async function resolve(specifier, context, nextResolve) {
    try {
        return await nextResolve(specifier, context);
    } catch (err) {
        if (err.code === 'ERR_MODULE_NOT_FOUND') {
            try {
                return await nextResolve(specifier, { ...context, parentURL: placeOrdersPkg });
            } catch {
                return await nextResolve(specifier, { ...context, parentURL: backtestAppPkg });
            }
        }
        throw err;
    }
}
