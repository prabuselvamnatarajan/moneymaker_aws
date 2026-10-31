export async function connectWithRetry(target, name = 'Client', retries = 30, delay = 5000, currentLogger = null) {
    for (let i = 0; i < retries; i++) {
        try {
            await target.connect();
            if (currentLogger) {
                currentLogger.info(`Successfully connected to ${name}.`);
            }
            return;
        } catch (err) {
            if (currentLogger) {
                currentLogger.warn(`Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`);
            }
            await new Promise(res => setTimeout(res, delay));
        }
    }
    throw new Error(`Failed to connect to ${name} after maximum retries.`);
}
