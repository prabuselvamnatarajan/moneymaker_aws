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

const tracker = await import('../positionTrackerConsumer.js');

describe('positionTrackerConsumer', () => {
    it('TC-PTC-001: Exports are present', () => {
        assert.ok(tracker.startServer);
        assert.ok(tracker.extractLtp);
        assert.ok(tracker.handleTick);
    });
});
