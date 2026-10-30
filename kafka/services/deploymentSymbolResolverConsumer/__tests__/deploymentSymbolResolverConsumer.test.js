import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

mock.module('/app/MicroServices/Shared/utils/logUtils.js', {
    namedExports: {
        initLogger: async () => {},
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    }
});

mock.module('/app/MicroServices/Shared/utils/kafkaErrorHandler.js', {
    namedExports: {
        handleFatalError: () => {},
        registerFatalErrorHandlers: () => {},
        registerKafkaCrashHandler: () => {}
    }
});

const resolver = await import('../deploymentSymbolResolverConsumer.js');

describe('deploymentSymbolResolverConsumer', () => {
    it('TC-DSR-001: Exports are present', () => {
        assert.ok(resolver.startServer);
        assert.ok(resolver.extractLtp);
        assert.ok(resolver.handleTick);
    });

    it('extractLtp returns null for non-objects', () => {
        assert.strictEqual(resolver.extractLtp(null), null);
        assert.strictEqual(resolver.extractLtp('string'), null);
    });

    it('extractLtp returns number directly if available', () => {
        assert.strictEqual(resolver.extractLtp({ ltp: 100 }), 100);
    });
});
