const config = {
    mongoUri: process.env.MONGO_URI,
    dbName: process.env.APP_INIT_DB || 'appInit',
    collection: process.env.DB_LIVE_WEBSOCKETLISTENING,
    redisKey: process.env.REDIS_LIVE_WEBSOCKETLISTENING?.key,
    redisDataType: process.env.REDIS_LIVE_WEBSOCKETLISTENING?.data_type,
    redisUrl: process.env.REDIS_URL,
    targetProperty: process.env.PROPERTY_LIVE_WEBSOCKETLISTENING
};

export { config };