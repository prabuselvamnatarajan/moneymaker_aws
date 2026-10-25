import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// 1. Define the mocks for AuthoriseUpstoxClient.js
const mockGetAuthorisedClient = mock.fn();
const mockResetAuthorisedClient = mock.fn();
const mockInvalidateUserAccessToken = mock.fn();

// 2. Mock the module using Node.js built-in module mocking
mock.module('../redis_utils/AuthoriseUpstoxClient.js', {
    namedExports: {
        getAuthorisedClient: mockGetAuthorisedClient,
        resetAuthorisedClient: mockResetAuthorisedClient,
        invalidateUserAccessToken: mockInvalidateUserAccessToken
    }
});

// 3. Import the app after mocking the dependencies
const appModule = await import('../server.js');
const app = appModule.default;

describe('GET / - Put Call Option Chain API', () => {

    beforeEach(() => {
        mockGetAuthorisedClient.mock.resetCalls();
        mockResetAuthorisedClient.mock.resetCalls();
        mockInvalidateUserAccessToken.mock.resetCalls();

        // Setup default resolve for invalidateUserAccessToken so it doesn't throw on .catch
        mockInvalidateUserAccessToken.mock.mockImplementation(() => Promise.resolve());
    });

    it('returns 400 if userId is missing', async () => {
        const response = await request(app).get('/?symbol=NIFTY&expiry=2024-12-26');
        assert.equal(response.status, 400);
        assert.equal(response.text, 'Bad Request: userId is required');
    });

    it('returns 400 if symbol is missing', async () => {
        const response = await request(app).get('/?userId=user123&expiry=2024-12-26');
        assert.equal(response.status, 400);
        assert.equal(response.text, 'Bad Request: symbol is required');
    });

    it('returns 400 if expiry is missing', async () => {
        const response = await request(app).get('/?userId=user123&symbol=NIFTY');
        assert.equal(response.status, 400);
        assert.equal(response.text, 'Bad Request: expiry is required');
    });

    it('handles authentication error correctly (returns 500 by default for generic error)', async () => {
        // Mock getAuthorisedClient to throw an error
        const authError = new Error('Auth Failed');
        authError.statusCode = 502;
        mockGetAuthorisedClient.mock.mockImplementation(() => Promise.reject(authError));

        const response = await request(app).get('/?userId=user123&symbol=NIFTY&expiry=2024-12-26');

        assert.equal(response.status, 502);
        assert.equal(response.text, 'Auth Failed');

        // Assert resetAuthorisedClient was called
        assert.equal(mockResetAuthorisedClient.mock.calls.length, 1);
    });

    it('returns 401 when Upstox API returns 401 and invalidates user token', async () => {
        // Mock UpstoxClient and OptionsApi
        const mockGetPutCallOptionChain = mock.fn((symbol, expiry, callback) => {
            const error = new Error('Unauthorized');
            error.status = 401;
            callback(error, null);
        });

        const mockOptionsApi = class {
            getPutCallOptionChain = mockGetPutCallOptionChain;
        };

        mockGetAuthorisedClient.mock.mockImplementation(() => Promise.resolve({
            OptionsApi: mockOptionsApi
        }));

        const response = await request(app).get('/?userId=user123&symbol=NIFTY&expiry=2024-12-26');

        assert.equal(response.status, 401);
        assert.equal(
            response.text,
            'Unauthorized: Invalid or expired Upstox access token — re-authenticate via Brokers page.'
        );

        assert.equal(mockResetAuthorisedClient.mock.calls.length, 1);
        assert.equal(mockInvalidateUserAccessToken.mock.calls.length, 1);
        assert.deepEqual(mockInvalidateUserAccessToken.mock.calls[0].arguments, ['user123']);
    });

    it('returns 500 when Upstox API fails with other errors and extracts error message', async () => {
        const mockGetPutCallOptionChain = mock.fn((symbol, expiry, callback) => {
            const error = new Error('Some API error');
            error.status = 500;
            error.response = {
                text: JSON.stringify({ errors: [{ message: 'Upstox internal server error details' }] })
            };
            callback(error, null);
        });

        const mockOptionsApi = class {
            getPutCallOptionChain = mockGetPutCallOptionChain;
        };

        mockGetAuthorisedClient.mock.mockImplementation(() => Promise.resolve({
            OptionsApi: mockOptionsApi
        }));

        const response = await request(app).get('/?userId=user123&symbol=NIFTY&expiry=2024-12-26');

        assert.equal(response.status, 500);
        assert.equal(
            response.text,
            'Internal Server Error: Upstox internal server error details'
        );

        assert.equal(mockResetAuthorisedClient.mock.calls.length, 1);
    });

    it('returns data successfully when Upstox API succeeds', async () => {
        const mockData = { status: 'success', data: { records: [] } };

        const mockGetPutCallOptionChain = mock.fn((symbol, expiry, callback) => {
            callback(null, mockData);
        });

        const mockOptionsApi = class {
            getPutCallOptionChain = mockGetPutCallOptionChain;
        };

        mockGetAuthorisedClient.mock.mockImplementation(() => Promise.resolve({
            OptionsApi: mockOptionsApi
        }));

        const response = await request(app).get('/?userId=user123&symbol=NIFTY&expiry=2024-12-26');

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, mockData);

        // Assert API was called with correct parameters
        assert.equal(mockGetPutCallOptionChain.mock.calls.length, 1);
        assert.deepEqual(mockGetPutCallOptionChain.mock.calls[0].arguments.slice(0, 2), ['NIFTY', '2024-12-26']);
    });
});
