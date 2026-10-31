import test from 'node:test';
import assert from 'node:assert/strict';

// Helper function equivalent to isUpstoxTokenExpired in AuthoriseUpstoxClient.js
function isUpstoxTokenExpired(token, skewSeconds = 60) {
    if (!token || typeof token !== 'string') return true;
    try {
        const parts = token.split('.');
        if (parts.length < 2) return true;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload.exp) return true;
        return Date.now() / 1000 >= payload.exp - skewSeconds;
    } catch {
        return true;
    }
}

test('isUpstoxTokenExpired accurately evaluates JWT exp claim', () => {
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
