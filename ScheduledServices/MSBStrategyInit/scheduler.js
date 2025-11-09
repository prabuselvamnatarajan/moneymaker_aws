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
const { get } = require('http');

const GET_LTP_URL = process.env.GET_LTP_URL;




async function addSymbolsToWatchListToRedis() {
    let symbol = 'NSE_INDEX|Nifty 50';
    let ltp = getLTP({ symbol });
    console.log(`LTP for ${symbol}:`, ltp);

    let relatedStrikePrices = await getRelatedStrikePrices(ltp, 50, noOfRelatedEntries = 0);

    const option_chain = await getOptionChain({ access_token, symbol: req.query.symbol || 'NSE_INDEX|Nifty 50', expiry_date: formatDateToYYYYMMDD(new Date(req.query.expiry)) });
    let relatedOptions = await getRelatedOptionContracts({ fulloptionchain: option_chain.data, relatedStrikePrices });

    let symbolsToWatch = relatedOptions[0] && [ relatedOptions[0].call_options?.instrument_key , relatedOptions[0].put_options?.instrument_key ];

    // Store symbolsToWatch in Redis
    





}

const cronSchedule = process.env.EXPORT_CRON_SCHEDULE || '15 16 * * *';

// Schedule job for export at time set in env
cron.schedule(cronSchedule, async () => {
    console.log(`[${new Date().toISOString()}] Scheduled export started (4:15 PM IST)`);
    await exportAll();
}, {
    timezone: 'Asia/Kolkata'
});
