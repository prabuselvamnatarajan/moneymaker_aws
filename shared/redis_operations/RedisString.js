class RedisString {
    constructor(client) {
        this.client = client;
    }

    async set(key, value) {
        return await this.client.set(key, value);
    }

    async get(key) {
        return await this.client.get(key);
    }

    async del(key) {
        return await this.client.del(key);
    }

    async incr(key) {
        return await this.client.incr(key);
    }

    async decr(key) {
        return await this.client.decr(key);
    }
}

export default RedisString;

