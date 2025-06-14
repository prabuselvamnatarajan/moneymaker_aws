class RedisHash {
    constructor(client) {
        this.client = client;
    }

    async hSet(key, field, value) {
        return await this.client.hSet(key, field, value);
    }

    async hGet(key, field) {
        return await this.client.hGet(key, field);
    }

    async hGetAll(key) {
        return await this.client.hGetAll(key);
    }

    async hDel(key, field) {
        return await this.client.hDel(key, field);
    }
}

export default RedisHash;

