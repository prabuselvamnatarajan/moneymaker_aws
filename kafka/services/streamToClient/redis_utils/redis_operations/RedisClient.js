import { createClient } from 'redis';

class RedisClient {
    constructor(options = {}) {
        this.client = createClient(options);
        this.client.on('error', (err) => console.log('Redis Client Error', err));
    }

    async connect() {
        if (!this.client.isOpen) {
            await this.client.connect();
            console.log('Connected to Redis');
        }
    }

    async disconnect() {
        if (this.client.isOpen) {
            await this.client.disconnect();
            console.log('Disconnected from Redis');
        }
    }

    getClient() {
        return this.client;
    }
}

export default RedisClient;
