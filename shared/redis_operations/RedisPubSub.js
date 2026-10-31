import { createClient } from 'redis';

class RedisPubSub {
    constructor(options = {}) {
        this.publisherClient = createClient(options);
        this.subscriberClient = createClient(options);
        this.subscriptions = new Map(); // Track subscriptions and their callbacks
        
        this.publisherClient.on('error', (err) => console.log('Redis Publisher Error', err));
        this.subscriberClient.on('error', (err) => console.log('Redis Subscriber Error', err));
    }

    async connect() {
        try {
            if (!this.publisherClient.isOpen) {
                await this.publisherClient.connect();
                console.log('Connected to Redis Publisher');
            }
            if (!this.subscriberClient.isOpen) {
                await this.subscriberClient.connect();
                console.log('Connected to Redis Subscriber');
            }
        } catch (err) {
            console.error('Error connecting to Redis:', err);
            throw err;
        }
    }

    async disconnect() {
        try {
            if (this.publisherClient.isOpen) {
                await this.publisherClient.disconnect();
                console.log('Disconnected from Redis Publisher');
            }
            if (this.subscriberClient.isOpen) {
                await this.subscriberClient.disconnect();
                console.log('Disconnected from Redis Subscriber');
            }
        } catch (err) {
            console.error('Error disconnecting from Redis:', err);
        }
    }

    async subscribe(channel, callback) {
        try {
            // Prevent duplicate subscriptions to same channel
            if (this.subscriptions.has(channel)) {
                console.log(`Already subscribed to channel: ${channel}`);
                return;
            }
            
            // Redis v4+ uses callback directly in subscribe
            // Callback signature: (message, subscribedChannel)
            await this.subscriberClient.subscribe(channel, (message, subscribedChannel) => {
                // Convert to (channel, message) for consistency
                if (callback) {
                    callback(subscribedChannel, message);
                }
            });
            
            this.subscriptions.set(channel, callback);
            console.log(`Subscribed to channel: ${channel}`);
        } catch (err) {
            console.error(`Error subscribing to channel ${channel}:`, err);
            throw err;
        }
    }

    async unsubscribe(channel) {
        try {
            await this.subscriberClient.unsubscribe(channel);
            this.subscriptions.delete(channel);
            console.log(`Unsubscribed from channel: ${channel}`);
        } catch (err) {
            console.error(`Error unsubscribing from channel ${channel}:`, err);
        }
    }

    async publish(channel, message) {
        try {
            const result = await this.publisherClient.publish(channel, message);
            console.log(`Published to channel: ${channel} with result: ${result}`);
            return result;
        } catch (err) {
            console.error(`Error publishing to channel ${channel}:`, err);
            throw err;
        }
    }

    getPublisherClient() {
        return this.publisherClient;
    }

    getSubscriberClient() {
        return this.subscriberClient;
    }
}

export default RedisPubSub;
