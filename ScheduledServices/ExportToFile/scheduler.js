if (!global.crypto) {
    const { randomFillSync } = require('crypto');
    global.crypto = {
        getRandomValues: (typedArray) => randomFillSync(typedArray),
    };
}


require('dotenv').config();
const cron = require('node-cron');
const { MongoClient } = require('mongodb');
const exportCollection = require('./exportCollections');

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const prefCollection = process.env.EXPORT_PREF_COLLECTION;

async function getCollectionsToExport() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);
        const prefColl = db.collection(prefCollection);
        const results = await prefColl.find({}).toArray();
        return results.map(doc => doc.collectionName).filter(Boolean);
    } catch (err) {
        console.error('Error fetching export preferences:', err.message);
        return [];
    } finally {
        await client.close();
    }
}

async function exportAll() {
    const collections = await getCollectionsToExport();
    console.log(`Starting export for: ${collections.join(', ')}`);
    await Promise.all(collections.map(exportCollection));
}

const cronSchedule = process.env.EXPORT_CRON_SCHEDULE || '15 16 * * *';

// Schedule job for export at time set in env
cron.schedule(cronSchedule, async () => {
    console.log(`[${new Date().toISOString()}] Scheduled export started (4:15 PM IST)`);
    await exportAll();
}, {
    timezone: 'Asia/Kolkata'
});
