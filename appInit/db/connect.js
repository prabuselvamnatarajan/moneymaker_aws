const { MongoClient } = require('mongodb');

async function connect(uri, dbName) {
    try {
        const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        return client.db(dbName);
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

module.exports = connect;
