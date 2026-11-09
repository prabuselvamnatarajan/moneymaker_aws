export function mongoCollectionNameForSymbol(symbol) {
    return symbol;
}

export function buildStoreDocument(data) {
    return { timestamp: new Date(), ...data };
}

export function parseKafkaMessage(message) {
    if (!message || message.key === undefined || message.key === null || message.value === undefined || message.value === null) {
        throw new Error('Invalid Kafka message format: key and value are required');
    }
    const symbol = message.key.toString();
    const data = JSON.parse(message.value.toString());
    return { symbol, data };
}
