import { store } from './account_utils.js';

const axios = {
    async post(url, body) {
        store.orders.push(body);
        if (store.orderFail) {
            const err = new Error('simulated order failure');
            throw err;
        }
        return { status: 200, data: { status: 'success' } };
    },
};

export default axios;
