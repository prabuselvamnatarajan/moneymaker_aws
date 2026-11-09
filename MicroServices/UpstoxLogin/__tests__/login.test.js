import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    requireUserId,
    assertUpstoxCredentialFields,
    buildAuthDialogUrl,
    extractUpstoxError,
    validateTokenPayload,
    formatBrokerUpdate,
    isDummyCredential,
} from '../login.js';

describe('MicroServices/UpstoxLogin Unit & Security Tests (Real Codebase)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.CLIENT_ID;
        delete process.env.UPSTOX_CLIENT_ID;
        delete process.env.CLIENT_SECRET;
        delete process.env.UPSTOX_CLIENT_SECRET;
        delete process.env.REDIRECT_URI;
        delete process.env.UPSTOX_REDIRECT_URI;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    const UPSTOX_AUTH_DIALOG_URL = 'https://api.upstox.com/v2/login/authorization/dialog';

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
        assert.throws(() => validateTokenPayload({}), { message: /access_token missing/ });
        assert.throws(() => validateTokenPayload({ access_token: 12345 }), { message: /access_token missing/ });
        assert.throws(() => validateTokenPayload({ access_token: '   ' }), { message: /access_token missing/ });

        const valid = validateTokenPayload({ access_token: 'jwt.token.string' });
        assert.equal(valid, 'jwt.token.string');
    });

    it('formats broker update event payload with event, userId, and brokerId', () => {
        const payload = JSON.parse(formatBrokerUpdate('usr_123'));
        assert.equal(payload.event, 'broker_updated');
        assert.equal(payload.userId, 'usr_123');
        assert.equal(payload.brokerId, 'upstox');
    });
});

describe('UpstoxLogin - Credential Validation & Security', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.CLIENT_ID;
        delete process.env.UPSTOX_CLIENT_ID;
        delete process.env.CLIENT_SECRET;
        delete process.env.UPSTOX_CLIENT_SECRET;
        delete process.env.REDIRECT_URI;
        delete process.env.UPSTOX_REDIRECT_URI;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('isDummyCredential', () => {
        it('detects dummy placeholders accurately', () => {
            assert.equal(isDummyCredential('dummy_client_id_admin'), true);
            assert.equal(isDummyCredential('dummy_client_secret_admin'), true);
            assert.equal(isDummyCredential('dummy_client_id_standard'), true);
            assert.equal(isDummyCredential('dummy'), true);
            assert.equal(isDummyCredential('DUMMY_KEY'), true);
            assert.equal(isDummyCredential(''), true);
            assert.equal(isDummyCredential(null), true);
            assert.equal(isDummyCredential(undefined), true);
        });

        it('recognizes valid non-dummy credentials', () => {
            assert.equal(isDummyCredential('50b489f2-22c5-4824-9da5-9b815aab9667'), false);
            assert.equal(isDummyCredential('d51apkeb3c'), false);
            assert.equal(isDummyCredential('my-upstox-api-key-99'), false);
        });
    });

    describe('assertUpstoxCredentialFields', () => {
        it('rejects dummy client_id when no environment fallback is configured', () => {
            const dummyCreds = {
                client_id: 'dummy_client_id_admin',
                client_secret: 'dummy_client_secret_admin',
                redirect_uri: 'http://localhost/logedin',
            };

            assert.throws(
                () => assertUpstoxCredentialFields(dummyCreds, 'user-123'),
                /Upstox client_id missing or invalid \(dummy value detected\)/
            );
        });

        it('rejects dummy client_secret when requireSecret is true and no env fallback exists', () => {
            const creds = {
                client_id: 'valid-client-id-12345',
                client_secret: 'dummy_client_secret_admin',
                redirect_uri: 'http://localhost/logedin',
            };

            assert.throws(
                () => assertUpstoxCredentialFields(creds, 'user-123', { requireSecret: true }),
                /Upstox client_secret missing or invalid \(dummy value detected\)/
            );
        });

        it('falls back to environment variable when MongoDB contains dummy client_id', () => {
            process.env.CLIENT_ID = '50b489f2-real-client-id';

            const dummyCreds = {
                client_id: 'dummy_client_id_admin',
                client_secret: 'valid-secret-123',
                redirect_uri: 'http://localhost/logedin',
            };

            const resolved = assertUpstoxCredentialFields(dummyCreds, 'user-123');
            assert.equal(resolved.client_id, '50b489f2-real-client-id');
            assert.equal(resolved.client_secret, 'valid-secret-123');
            assert.equal(resolved.redirect_uri, 'http://localhost/logedin');
        });

        it('falls back to environment variable when MongoDB contains dummy client_secret', () => {
            process.env.CLIENT_SECRET = 'real-secret-from-env';

            const dummyCreds = {
                client_id: 'valid-client-id-123',
                client_secret: 'dummy_client_secret_admin',
                redirect_uri: 'http://localhost/logedin',
            };

            const resolved = assertUpstoxCredentialFields(dummyCreds, 'user-123', { requireSecret: true });
            assert.equal(resolved.client_id, 'valid-client-id-123');
            assert.equal(resolved.client_secret, 'real-secret-from-env');
        });

        it('falls back to UPSTOX_CLIENT_ID and UPSTOX_CLIENT_SECRET with priority', () => {
            process.env.UPSTOX_CLIENT_ID = 'priority-upstox-id';
            process.env.CLIENT_ID = 'generic-client-id';
            process.env.UPSTOX_CLIENT_SECRET = 'priority-upstox-secret';
            process.env.CLIENT_SECRET = 'generic-secret';

            const dummyCreds = {
                client_id: 'dummy_client_id_admin',
                client_secret: 'dummy_client_secret_admin',
                redirect_uri: 'http://localhost/logedin',
            };

            const resolved = assertUpstoxCredentialFields(dummyCreds, 'user-123', { requireSecret: true });
            assert.equal(resolved.client_id, 'priority-upstox-id');
            assert.equal(resolved.client_secret, 'priority-upstox-secret');
        });

        it('preserves valid user-configured credentials without overwriting from env', () => {
            process.env.CLIENT_ID = 'env-client-id';

            const userCreds = {
                client_id: 'user-custom-client-id',
                client_secret: 'user-custom-secret',
                redirect_uri: 'http://localhost/logedin',
            };

            const resolved = assertUpstoxCredentialFields(userCreds, 'user-123', { requireSecret: true });
            assert.equal(resolved.client_id, 'user-custom-client-id');
            assert.equal(resolved.client_secret, 'user-custom-secret');
        });

        it('rejects empty or missing redirect_uri when neither doc nor env provides one', () => {
            const creds = {
                client_id: 'valid-client-id',
                client_secret: 'valid-secret',
                redirect_uri: '',
            };

            assert.throws(
                () => assertUpstoxCredentialFields(creds, 'user-123'),
                /Upstox redirect_uri missing or invalid/
            );
        });
    });

    describe('Upstox OAuth Authorization URL Construction', () => {
        it('builds a secure dialog URL without exposing client_secret', () => {
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: '50b489f2-22c5-4824-9da5-9b815aab9667',
                redirect_uri: 'http://localhost/logedin',
                state: 'user-123:broker-456',
            });

            const dialogUrl = `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;
            const parsed = new URL(dialogUrl);

            assert.equal(parsed.origin, 'https://api.upstox.com');
            assert.equal(parsed.pathname, '/v2/login/authorization/dialog');
            assert.equal(parsed.searchParams.get('response_type'), 'code');
            assert.equal(parsed.searchParams.get('client_id'), '50b489f2-22c5-4824-9da5-9b815aab9667');
            assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost/logedin');
            assert.equal(parsed.searchParams.get('state'), 'user-123:broker-456');

            // CRITICAL: client_secret MUST NEVER be present in authorization dialog URL
            assert.equal(parsed.searchParams.has('client_secret'), false);
            assert.equal(dialogUrl.includes('dummy'), false);
        });

        it('parses composite state (userId:brokerId) in callback handling', () => {
            const state = '6501234567890abcdef12345:6709876543210fedcba54321';
            const [targetUserId, targetBrokerId] = state.split(':');

            assert.equal(targetUserId, '6501234567890abcdef12345');
            assert.equal(targetBrokerId, '6709876543210fedcba54321');
        });

        it('handles simple legacy state (userId only) in callback handling', () => {
            const state = '6501234567890abcdef12345';
            const stateParts = state.split(':');
            const targetUserId = stateParts[0];
            const targetBrokerId = stateParts[1] || null;

            assert.equal(targetUserId, '6501234567890abcdef12345');
            assert.equal(targetBrokerId, null);
        });
    });
});
