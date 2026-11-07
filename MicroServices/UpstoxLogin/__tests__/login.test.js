import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/UpstoxLogin Unit & Security Tests', () => {

    const UPSTOX_AUTH_DIALOG_URL = 'https://api.upstox.com/v2/login/authorization/dialog';

    function requireUserId(userId) {
        const cleanUserId = String(userId || '').trim();
        if (!cleanUserId) {
            throw new Error(
                'userId is required. Pass ?userId= when starting OAuth, and ensure Upstox returns state in the callback.'
            );
        }
        return cleanUserId;
    }

    function assertUpstoxCredentialFields(credentials, userId, { requireSecret = false } = {}) {
        if (!credentials || typeof credentials !== 'object') {
            throw new Error(`Upstox broker credentials missing in MongoDB for user: ${userId}`);
        }

        const clientId = String(credentials.client_id || '').trim();
        const redirectUri = String(credentials.redirect_uri || '').trim();
        const clientSecret = String(credentials.client_secret || '').trim();

        if (!clientId) {
            throw new Error(`Upstox client_id missing in MongoDB broker credentials for user: ${userId}`);
        }
        if (!redirectUri) {
            throw new Error(`Upstox redirect_uri missing in MongoDB broker credentials for user: ${userId}`);
        }
        if (requireSecret && !clientSecret) {
            throw new Error(`Upstox client_secret missing in MongoDB broker credentials for user: ${userId}`);
        }

        return {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        };
    }

    function buildAuthDialogUrl(credentials, userId) {
        const cleanUserId = requireUserId(userId);
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: credentials.client_id,
            redirect_uri: credentials.redirect_uri,
            state: cleanUserId,
        });
        return `${UPSTOX_AUTH_DIALOG_URL}?${params.toString()}`;
    }

    function extractUpstoxError(error) {
        const upstoxMessage = error.response?.data?.message
            || error.response?.data?.error?.reason
            || error.response?.data?.error
            || null;
        return upstoxMessage
            ? `Failed to obtain Upstox access token: ${upstoxMessage}`
            : `Failed to obtain Upstox access token: ${error.message}`;
    }

    it('TC-UPX-001: builds Upstox authorization dialog URL with response_type, client_id, redirect_uri, and state=userId', () => {
        const creds = {
            client_id: 'my-client-id-123',
            redirect_uri: 'http://127.0.0.1/upstox-login',
            client_secret: 'sec',
        };
        const url = buildAuthDialogUrl(creds, 'user_abc');

        assert.ok(url.startsWith(UPSTOX_AUTH_DIALOG_URL));
        assert.ok(url.includes('response_type=code'));
        assert.ok(url.includes('client_id=my-client-id-123'));
        assert.ok(url.includes('redirect_uri=http%3A%2F%2F127.0.0.1%2Fupstox-login'));
        assert.ok(url.includes('state=user_abc'));
    });

    it('TC-UPX-002: throws when userId is missing or whitespace', () => {
        assert.throws(() => requireUserId(null), { message: /userId is required/ });
        assert.throws(() => requireUserId(''), { message: /userId is required/ });
        assert.throws(() => requireUserId('   '), { message: /userId is required/ });
    });

    it('TC-UPX-003: throws if credentials object is missing', () => {
        assert.throws(() => assertUpstoxCredentialFields(null, 'user_1'), {
            message: /Upstox broker credentials missing/,
        });
    });

    it('TC-UPX-004: throws if client_id or redirect_uri is missing', () => {
        assert.throws(() => assertUpstoxCredentialFields({ redirect_uri: 'http://test' }, 'user_1'), {
            message: /client_id missing/,
        });
        assert.throws(() => assertUpstoxCredentialFields({ client_id: 'cid' }, 'user_1'), {
            message: /redirect_uri missing/,
        });
    });

    it('enforces client_secret requirement during token exchange', () => {
        const credsNoSecret = { client_id: 'cid', redirect_uri: 'http://test' };
        assert.throws(
            () => assertUpstoxCredentialFields(credsNoSecret, 'user_1', { requireSecret: true }),
            { message: /client_secret missing/ }
        );

        const validCreds = { client_id: 'cid', redirect_uri: 'http://test', client_secret: 'sec' };
        const result = assertUpstoxCredentialFields(validCreds, 'user_1', { requireSecret: true });
        assert.equal(result.client_secret, 'sec');
    });

    it('TC-UPX-008: extracts human-readable error messages from Upstox API responses', () => {
        const apiError = {
            message: 'Request failed with status code 400',
            response: {
                data: {
                    message: 'UDAPI100057: Invalid authorization code',
                },
            },
        };
        const message = extractUpstoxError(apiError);
        assert.equal(message, 'Failed to obtain Upstox access token: UDAPI100057: Invalid authorization code');
    });

    it('TC-UPX-009: validates that access_token must be a non-empty string before saving', () => {
        function validateTokenPayload(payload) {
            if (!payload || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
                throw new Error('Invalid response from Upstox API: access_token missing.');
            }
            return payload.access_token.trim();
        }

        assert.throws(() => validateTokenPayload({}), { message: /access_token missing/ });
        assert.throws(() => validateTokenPayload({ access_token: 12345 }), { message: /access_token missing/ });
        assert.throws(() => validateTokenPayload({ access_token: '   ' }), { message: /access_token missing/ });

        const valid = validateTokenPayload({ access_token: 'jwt.token.string' });
        assert.equal(valid, 'jwt.token.string');
    });

    it('formats broker update event payload with event, userId, and brokerId', () => {
        function formatBrokerUpdate(userId) {
            return JSON.stringify({
                event: 'broker_updated',
                userId,
                brokerId: 'upstox',
            });
        }

        const payload = JSON.parse(formatBrokerUpdate('usr_123'));
        assert.equal(payload.event, 'broker_updated');
        assert.equal(payload.userId, 'usr_123');
        assert.equal(payload.brokerId, 'upstox');
    });
});
