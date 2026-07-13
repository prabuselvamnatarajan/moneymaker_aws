if (!global.crypto) {
    const { randomFillSync } = require('crypto');
    global.crypto = {
        getRandomValues: (typedArray) => randomFillSync(typedArray),
    };
}


require('dotenv').config();
const cron = require('node-cron');
const { MongoClient } = require('mongodb');
const { getLTP, getRelatedStrikePrices, getRelatedOptionContracts} = require('./util.js');
const exportCollection = require('./exportCollections.js');

const GET_LTP_URL = process.env.GET_LTP_URL;
const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const prefCollection = process.env.EXPORT_PREF_COLLECTION || 'exportPreferences';

async function addSymbolsToWatchListToRedis() {
    console.log("addSymbolsToWatchListToRedis is currently not active.");
}

async function getCollectionsToExport() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);
        const prefColl = db.collection(prefCollection);
        const results = await prefColl.find({}).toArray();
        const collections = [];
        for (const doc of results) {
            if (doc.collectionName) {
                collections.push(doc.collectionName);
            }
            if (doc.symbolName) {
                collections.push(doc.symbolName);
            }
        }
        return [...new Set(collections)].filter(Boolean);
    } catch (err) {
        console.error('Error fetching export preferences:', err.message);
        return [];
    } finally {
        await client.close();
    }
}

async function exportAll() {
    let collections = [];
    try {
        collections = await getCollectionsToExport();
    } catch (err) {
        console.error('Error fetching export preferences in exportAll:', err.message);
    }
    const collectionsToExport = [...new Set([...collections, 'usersymbols'])];
    console.log(`Starting export for: ${collectionsToExport.join(', ')}`);
    await Promise.all(collectionsToExport.map(async (coll) => {
        try {
            await exportCollection(coll);
        } catch (err) {
            console.error(`Failed to export collection/symbol ${coll}:`, err.message);
        }
    }));
}

const cronSchedule = process.env.EXPORT_CRON_SCHEDULE || '15 16 * * *';

// Schedule job for export at time set in env
cron.schedule(cronSchedule, async () => {
    console.log(`[${new Date().toISOString()}] Scheduled export started (4:15 PM IST)`);
    await exportAll();
}, {
    timezone: 'Asia/Kolkata'
});
