class RedisSortedSet {
    constructor(client) {
        this.client = client;
    }

    async zAdd(key, score, member) {
        return await this.client.zAdd(key, { score, member });
    }

    async zRange(key, min, max) {
        return await this.client.zRange(key, min, max);
    }

    async zRem(key, member) {
        return await this.client.zRem(key, member);
    }

    async zCard(key) {
        return await this.client.zCard(key);
    }

    async zScore(key, member) {
        return await this.client.zScore(key, member);
    }
}

export default RedisSortedSet;
