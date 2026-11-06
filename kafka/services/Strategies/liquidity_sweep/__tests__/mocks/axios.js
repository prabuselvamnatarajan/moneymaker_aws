const axios = {
    async post() {
        return { status: 200, data: { status: 'success' } };
    },
    async get() {
        return { status: 200, data: {} };
    },
};

export default axios;
