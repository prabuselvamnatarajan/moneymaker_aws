/** Order bodies POSTed to the placeorder API, in order (tests read and clear it). */
export const sentOrders = [];

const axios = {
    async post(_url, body) {
        sentOrders.push(body);
        return { status: 200, data: { status: 'success' } };
    },
    async get() {
        return { status: 200, data: {} };
    },
};

export default axios;
