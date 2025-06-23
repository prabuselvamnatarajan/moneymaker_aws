const config = {
    mongoUri: process.env.MONGO_URI,
    dbName: process.env.APP_INIT_DB || 'appInit',
    collection: process.env.DB_LIVE_STRATEGYCHOOSER,
    redisKey: process.env.REDIS_LIVE_STRATEGYCHOOSER?.key,
    redisDataType: process.env.REDIS_LIVE_STRATEGYCHOOSER?.data_type,
    redisUrl: process.env.REDIS_URL,
    targetProperty: process.env.PROPERTY_LIVE_STRATEGYCHOOSER
};

export { config };