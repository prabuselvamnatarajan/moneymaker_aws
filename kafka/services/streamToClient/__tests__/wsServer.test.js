import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fanoutRedisMessage } from '../fanout.js';

describe('streamToClient fanoutRedisMessage', () => {
    it('sends the payload to every open subscriber of the channel', () => {
        const sent = [];
        const sockets = new Map([
            ['a', { readyState: 1, OPEN: 1, send: (msg) => sent.push(['a', msg]) }],
            ['b', { readyState: 1, OPEN: 1, send: (msg) => sent.push(['b', msg]) }],
        ]);
        const channelSubscriptions = new Map([['live:NIFTY', new Set(['a', 'b'])]]);

        const count = fanoutRedisMessage(channelSubscriptions, sockets, 'live:NIFTY', '{"ltp":1}');
        assert.equal(count, 2);
        assert.deepEqual(sent, [['a', '{"ltp":1}'], ['b', '{"ltp":1}']]);
    });

    it('does nothing when the channel has no subscribers', () => {
        const count = fanoutRedisMessage(new Map(), new Map(), 'live:NIFTY', 'x');
        assert.equal(count, 0);
    });

    it('skips sockets that are not OPEN', () => {
        const sent = [];
        const sockets = new Map([
            ['a', { readyState: 3, OPEN: 1, send: (msg) => sent.push(msg) }],
        ]);
        const channelSubscriptions = new Map([['live:NIFTY', new Set(['a'])]]);
        const count = fanoutRedisMessage(channelSubscriptions, sockets, 'live:NIFTY', 'x');
        assert.equal(count, 0);
        assert.equal(sent.length, 0);
    });
});
