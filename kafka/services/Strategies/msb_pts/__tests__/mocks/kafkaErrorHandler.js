export function handleFatalError(error, context = 'service') {
    throw error instanceof Error ? error : new Error(String(error ?? context));
}

export function registerFatalErrorHandlers() {}

export function registerKafkaCrashHandler() {}
