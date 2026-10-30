import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from './server.js';
import * as dependency from './dependency.js';
import * as AuthoriseUpstoxClient from './redis_utils/AuthoriseUpstoxClient.js';
import * as account_utils from './redis_utils/account_utils.js';
import * as resolveBalanceAfterLiveOrder from './resolveBalanceAfterLiveOrder.js';

describe('placeOrders API', () => {
    it('TC-PO-002: Missing instrument_token returns 400', async () => {
        const response = await request(app)
            .post('/')
            .send({
                price: 100,
                quantity: 1,
                transaction_type: 'BUY',
                strategy_details: { user_id: 'test' }
            });

        assert.strictEqual(response.status, 400);
        assert.match(response.text, /Missing required order fields/);
    });
});
