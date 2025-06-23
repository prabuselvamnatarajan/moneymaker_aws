class RedisList {
    constructor(client) {
        this.client = client;
    }

    async lPush(key, value) {
        return await this.client.lPush(key, value);
    }

    async rPush(key, value) {
        return await this.client.rPush(key, value);
    }

    async lPop(key) {
        return await this.client.lPop(key);
    }

    async rPop(key) {
        return await this.client.rPop(key);
    }

    async lRange(key, start, end) {
        return await this.client.lRange(key, start, end);
    }

    async lLen(key) {
        return await this.client.lLen(key);
    }
}

export default RedisList;

