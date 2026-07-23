import { store } from './account_utils.js';

const axios = {
    async post(url, body) {
        store.orders.push(body);
        if (store.orderFail) {
            throw new Error('simulated order failure');
        }
        return { status: 200, data: { status: 'success' } };
    },
};

export default axios;
