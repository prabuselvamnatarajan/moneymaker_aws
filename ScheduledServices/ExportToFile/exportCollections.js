require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const EXPORT_VOLUME_PATH = process.env.EXPORT_VOLUME_PATH;

// IST timezone
const IST = 'Asia/Kolkata';

async function exportCollection(collectionName) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    let targetDbName = dbName;
    let timeField = 'timestamp';

    const todayIST = DateTime.now().setZone(IST);
    const dateFolder = todayIST.toFormat('yyyy-MM-dd');
    const exportPath = path.join(EXPORT_VOLUME_PATH ? EXPORT_VOLUME_PATH : path.join(__dirname, 'exportedData'), dateFolder);
    fs.mkdirSync(exportPath, { recursive: true });

    const sanitizedCollectionName = collectionName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filePath = path.join(exportPath, `${sanitizedCollectionName}.json`);

    if (collectionName === 'usersymbols') {
      targetDbName = 'BacktestApp';
      const db = client.db(targetDbName);
      const collection = db.collection(collectionName);
      const activeSymbols = await collection.find({ is_active: true }).toArray();
      const seen = new Set();
      const cleanSymbols = [];
      for (const sym of activeSymbols) {
        if (sym.instrument_token && !seen.has(sym.instrument_token)) {
          seen.add(sym.instrument_token);
          const { _id, user_id, ...cleanSym } = sym;
          cleanSymbols.push(cleanSym);
        }
      }

      // Export the active symbols' stock data from stock_database
      const stockDb = client.db('stock_database');
      const start = todayIST.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate();
      const end = todayIST.set({ hour: 15, minute: 40, second: 0, millisecond: 0 }).toUTC().toJSDate();

      for (const sym of cleanSymbols) {
        const symName = sym.symbol;
        if (!symName) continue;

        try {
          const symCollection = stockDb.collection(symName);
          // Ensure index on timestamp exists to optimize query execution and avoid collection scans
          await symCollection.createIndex({ timestamp: 1 });
          
          const sanitizedSymName = symName.replace(/[^a-zA-Z0-9-_]/g, '_');
          const symFilePath = path.join(exportPath, `${sanitizedSymName}.json`);

          const cursor = symCollection.find({ timestamp: { $gte: start, $lte: end } });
          let recordCount = 0;
          const writeStream = fs.createWriteStream(symFilePath);
          writeStream.write('[');
          let isFirst = true;
          for await (const doc of cursor) {
            if (!isFirst) {
              writeStream.write(',');
            }
            writeStream.write(JSON.stringify(doc));
            isFirst = false;
            recordCount++;
          }
          writeStream.write(']');
          await new Promise((resolve, reject) => {
            writeStream.end();
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });

          console.log(`Exported active symbol collection: ${symName} (${recordCount} records) to ${symFilePath}`);
        } catch (symErr) {
          console.error(`Error exporting active symbol collection ${symName}:`, symErr.message);
        }
      }

      // Write usersymbols collection metadata
      await fs.promises.writeFile(filePath, JSON.stringify(cleanSymbols));
      console.log(`Exported ${cleanSymbols.length} documents from ${collectionName} to ${filePath}`);

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
      
      // Optimize stock database collection queries by ensuring index
      if (targetDbName === 'stock_database') {
        await collection.createIndex({ [timeField]: 1 });
      }

      const cursor = collection.find(query);
      
      // Use streaming to write cursor output directly to file
      const writeStream = fs.createWriteStream(filePath);
      writeStream.write('[');
      let isFirst = true;
      let recordCount = 0;
      for await (const doc of cursor) {
        if (!isFirst) {
          writeStream.write(',');
        }
        writeStream.write(JSON.stringify(doc));
        isFirst = false;
        recordCount++;
      }
      writeStream.write(']');
      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      console.log(`Exported ${recordCount} documents from ${collectionName} to ${filePath}`);
    }
  } catch (err) {
    console.error(`Error exporting ${collectionName}:`, err.message);
  } finally {
    await client.close();
  }
}

module.exports = exportCollection;
