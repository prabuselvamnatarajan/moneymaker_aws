import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractUpstoxErrorMessage } from '../utils.js';

describe('extractUpstoxErrorMessage', () => {
    it('extracts error message from error.response.text JSON', () => {
        const error = {
            response: {
                text: JSON.stringify({ errors: [{ message: 'Insufficient funds' }] })
            }
        };
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Insufficient funds');
    });

    it('extracts error message from error.text JSON', () => {
        const error = {
            text: JSON.stringify({ errors: [{ message: 'Invalid token' }] })
        };
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Invalid token');
    });

    it('falls back to error.message if JSON parse fails', () => {
        const error = {
            response: {
                text: '<html>Some HTML error page</html>'
            },
            message: 'HTML error fallback'
        };
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'HTML error fallback');
    });

    it('falls back to error.message if JSON parsed successfully but no message is found', () => {
        const error = {
            response: {
                text: JSON.stringify({ otherField: 'some value' })
            },
            message: 'Missing message fallback'
        };
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Missing message fallback');
    });

    it('falls back to error.message if errors array is empty', () => {
        const error = {
            response: {
                text: JSON.stringify({ errors: [] })
            },
            message: 'Empty array fallback'
        };
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Empty array fallback');
    });

    it('falls back to "Upstox API request failed" if error object is completely empty or undefined text/message', () => {
        const error = {};
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Upstox API request failed');
    });

    it('handles null error gracefully', () => {
        const error = null;
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Upstox API request failed');
    });

    it('uses generic fallback if error.message is empty string', () => {
        const error = {
            message: ''
        };
        const result = extractUpstoxErrorMessage(error);
        assert.equal(result, 'Upstox API request failed');
    });
});
