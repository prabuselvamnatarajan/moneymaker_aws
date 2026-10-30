class RedisSet {
    constructor(client) {
        this.client = client;
    }

    async sAdd(key, member) {
        return await this.client.sAdd(key, member);
    }

    async sMembers(key) {
        return await this.client.sMembers(key);
    }

    async sRem(key, member) {
        return await this.client.sRem(key, member);
    }

    async sIsMember(key, member) {
        return await this.client.sIsMember(key, member);
    }

    async sCard(key) {
        return await this.client.sCard(key);
    }
}

export default RedisSet;
