require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const {
  IST,
  sanitizeCollectionName,
  resolveTargetDbAndTimeField,
  calculateTimeWindow,
  sanitizeUserSymbols,
} = require('./exportUtils');

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
// Canonical layout: {SHARED_DIR}/exportedData/{yyyy-MM-dd}/{symbol}.json
// EXPORT_VOLUME_PATH kept as alias for older compose files.
const SHARED_DIR = process.env.SHARED_DIR || process.env.EXPORT_VOLUME_PATH || '/shared';
const EXPORTED_DATA_DIR = process.env.EXPORTED_DATA_DIR || path.join(SHARED_DIR, 'exportedData');

async function exportCollection(collectionName) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    let targetDbName = dbName;
    let timeField = 'timestamp';

    const todayIST = DateTime.now().setZone(IST);
    const dateFolder = todayIST.toFormat('yyyy-MM-dd');
    const exportPath = path.join(EXPORTED_DATA_DIR, dateFolder);
    fs.mkdirSync(exportPath, { recursive: true });

    const sanitizedCollectionName = sanitizeCollectionName(collectionName);
    const filePath = path.join(exportPath, `${sanitizedCollectionName}.json`);

    if (collectionName === 'usersymbols') {
      targetDbName = 'BacktestApp';
      const db = client.db(targetDbName);
      const collection = db.collection(collectionName);
      const activeSymbols = await collection.find({ is_active: true }).toArray();
      const cleanSymbols = sanitizeUserSymbols(activeSymbols);

      // Export the active symbols' stock data from stock_database
      const stockDb = client.db('stock_database');
      const { start, end } = calculateTimeWindow('stock_database', todayIST);

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
      const resolved = resolveTargetDbAndTimeField(collectionName, targetDbName);
      targetDbName = resolved.targetDbName;
      timeField = resolved.timeField;

      if (targetDbName === dbName && !collectionName.includes(':') && !collectionName.includes('|')) {
        const stockDb = client.db('stock_database');
        const collections = await stockDb.listCollections({ name: collectionName }).toArray();
        if (collections.length > 0) {
          targetDbName = 'stock_database';
          timeField = 'timestamp';
        }
      }

      const db = client.db(targetDbName);
      const collection = db.collection(collectionName);

      // Get date range in IST
      const { start, end } = calculateTimeWindow(targetDbName, todayIST);

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
