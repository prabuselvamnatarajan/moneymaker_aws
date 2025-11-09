require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;

// IST timezone
const IST = 'Asia/Kolkata';

async function exportCollection(collectionName) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Get today's date range in IST
    const todayIST = DateTime.now().setZone(IST);
    const start = todayIST.startOf('day').toUTC().toJSDate();
    const end = todayIST.endOf('day').toUTC().toJSDate();

    const query = { timestamp: { $gte: start, $lte: end } };
    const data = await collection.find(query).toArray();

    const dateFolder = todayIST.toFormat('yyyy-MM-dd');
    const exportPath = path.join(process.env.EXPORT_VOLUME_PATH ? path.join(process.env.EXPORT_VOLUME_PATH, 'exportedData') : path.join(__dirname, 'exportedData'), dateFolder);
    fs.mkdirSync(exportPath, { recursive: true });

    const sanitizedCollectionName = collectionName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filePath = path.join(exportPath, `${sanitizedCollectionName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    console.log(`Exported ${data.length} documents from ${collectionName} to ${filePath}`);
  } catch (err) {
    console.error(`Error exporting ${collectionName}:`, err.message);
  } finally {
    await client.close();
  }
}

module.exports = exportCollection;
