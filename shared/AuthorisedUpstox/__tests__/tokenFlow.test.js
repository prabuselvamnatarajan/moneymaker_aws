import test from 'node:test';
import assert from 'node:assert/strict';
import { isUpstoxTokenExpired } from '../AuthoriseUpstoxClient.js';

test('isUpstoxTokenExpired accurately evaluates JWT exp claim (Real Codebase)', () => {
    assert.equal(isUpstoxTokenExpired(null), true);
    assert.equal(isUpstoxTokenExpired('invalid.jwt'), true);

    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const futurePayload = Buffer.from(JSON.stringify({ exp: futureExp })).toString('base64url');
    const validToken = `header.${futurePayload}.signature`;
    assert.equal(isUpstoxTokenExpired(validToken), false);

    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const pastPayload = Buffer.from(JSON.stringify({ exp: pastExp })).toString('base64url');
    const expiredToken = `header.${pastPayload}.signature`;
    assert.equal(isUpstoxTokenExpired(expiredToken), true);
});
