export function mongoCollectionNameForSymbol(symbol) {
    return symbol;
}

export function buildStoreDocument(data) {
    return { timestamp: new Date(), ...data };
}
