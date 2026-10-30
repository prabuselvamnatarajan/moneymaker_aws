import { logger } from './logUtils.js';

export function handleFatalError(error, context = 'service') {
    if (logger && typeof logger.error === 'function') {
        logger.error(`Fatal error in ${context}:`, error);
    } else {
        console.error(`Fatal error in ${context}:`, error);
    }
    process.exit(1);
}

export function registerFatalErrorHandlers() {
    process.on('uncaughtException', (error) => {
        handleFatalError(error, 'uncaught exception');
    });

    process.on('unhandledRejection', (reason) => {
        handleFatalError(reason, 'unhandled rejection');
    });
}

export function registerKafkaCrashHandler(consumer) {
    if (consumer && consumer.events && consumer.events.CRASH) {
        consumer.on(consumer.events.CRASH, (event) => {
            handleFatalError(event.payload.error, 'Kafka consumer crash');
        });
    }
}
