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
    let targetDbName = dbName;
    let timeField = 'timestamp';
    let data;

    const todayIST = DateTime.now().setZone(IST);
    const dateFolder = todayIST.toFormat('yyyy-MM-dd');
    const exportPath = path.join(process.env.EXPORT_VOLUME_PATH ? path.join(process.env.EXPORT_VOLUME_PATH, 'exportedData') : path.join(__dirname, 'exportedData'), dateFolder);
    fs.mkdirSync(exportPath, { recursive: true });

    const sanitizedCollectionName = collectionName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filePath = path.join(exportPath, `${sanitizedCollectionName}.json`);

    if (collectionName === 'usersymbols') {
      targetDbName = 'BacktestApp';
      const db = client.db(targetDbName);
      const collection = db.collection(collectionName);
      const activeSymbols = await collection.find({ is_active: true }).toArray();
      const seen = new Set();
      data = [];
      for (const sym of activeSymbols) {
        if (sym.instrument_token && !seen.has(sym.instrument_token)) {
          seen.add(sym.instrument_token);
          const { _id, user_id, ...cleanSym } = sym;
          data.push(cleanSym);
        }
      }
    } else {
      if (collectionName === 'trades') {
        targetDbName = 'BacktestApp';
        timeField = 'created_at';
      } else if (collectionName === 'ledgers') {
        targetDbName = 'BacktestApp';
        timeField = 'created_on';
      } else {
        if (collectionName.includes(':') || collectionName.includes('|')) {
          targetDbName = 'stock_database';
          timeField = 'timestamp';
        } else {
          const stockDb = client.db('stock_database');
          const collections = await stockDb.listCollections({ name: collectionName }).toArray();
          if (collections.length > 0) {
            targetDbName = 'stock_database';
            timeField = 'timestamp';
          }
        }
      }

      const db = client.db(targetDbName);
      const collection = db.collection(collectionName);

      // Get date range in IST
      let start, end;
      if (targetDbName === 'stock_database') {
        start = todayIST.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate();
        end = todayIST.set({ hour: 15, minute: 40, second: 0, millisecond: 0 }).toUTC().toJSDate();
      } else {
        start = todayIST.startOf('day').toUTC().toJSDate();
        end = todayIST.endOf('day').toUTC().toJSDate();
      }

      const query = { [timeField]: { $gte: start, $lte: end } };
      data = await collection.find(query).toArray();
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    console.log(`Exported ${data.length} documents from ${collectionName} to ${filePath}`);
  } catch (err) {
    console.error(`Error exporting ${collectionName}:`, err.message);
  } finally {
    await client.close();
  }
}

module.exports = exportCollection;
