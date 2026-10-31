import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';

mock.module('../dependency.js', {
    namedExports: {
        storeOrderDetails: () => {},
        placeOrders: async () => ({}),
        triggerBackTestApp: async () => ({}),
        getLiveAccountBalance: async () => null,
        buildBrokerOrderPayload: (body) => body,
    },
});

mock.module('../redis_utils/AuthoriseUpstoxClient.js', {
    namedExports: {
        getAccessTokenFromRedis: async () => 'token',
    },
});

mock.module('../redis_utils/account_utils.js', {
    namedExports: {
        setAccountBalanceToRedis: async () => {},
    },
});

let app;

describe('placeOrders API', () => {
    before(async () => {
        ({ default: app } = await import('../server.js'));
    });

    it('returns 400 when instrument_token is missing', async () => {
        const response = await request(app)
            .post('/')
            .send({
                price: 100,
                quantity: 1,
                transaction_type: 'BUY',
                strategy_details: { user_id: 'test' },
            });

        assert.equal(response.status, 400);
        assert.match(response.text, /Missing required order fields/);
    });
});
