const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { getSourceData } = require('./sourceRetriever');

// Canonical layout matches exporttofile:
//   {SHARED_DIR}/exportedData/{yyyy-MM-dd}/{symbol}.json
const PORT = process.env.PORT || 8085;
const SHARED_DIR = process.env.SHARED_DIR || '/shared';
const EXPORTED_DATA_DIR = process.env.EXPORTED_DATA_DIR || path.join(SHARED_DIR, 'exportedData');

const wss = new WebSocket.Server({ port: PORT });

function sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function extractFeed(item) {
    if (!item || typeof item !== 'object') return null;
    return item.fullFeed?.marketFF
        || item.fullFeed?.indexFF
        || item.marketFF
        || item.indexFF
        || item.feed
        || null;
}

function extractLtp(item) {
    if (!item || typeof item !== 'object') return null;
    const raw = extractFeed(item)?.ltpc?.ltp ?? item.ltpc?.ltp ?? item.ltp ?? null;
    if (raw == null || raw === '') return null;
    const ltp = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(ltp) && ltp > 0 ? ltp : null;
}

function extractTickTimeMs(item) {
    if (!item || typeof item !== 'object') return null;
    const ltt = extractFeed(item)?.ltpc?.ltt ?? item.ltpc?.ltt;
    if (ltt != null && ltt !== '') {
        const ms = typeof ltt === 'number' ? ltt : parseInt(ltt, 10);
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    if (item.timestamp) {
        const ms = new Date(item.timestamp).getTime();
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return null;
}

wss.on('connection', ws => {
    ws.on('message', async message => {
        // Expecting JSON: { symbolName: "AAPL", date: "2024-06-01", time_ms: 1000 }
        let req;
        try {
            req = JSON.parse(message);
        } catch (e) {
            ws.send(JSON.stringify({ error: 'Invalid JSON' }));
            return;
        }
        const { symbolName, date, time_ms } = req;
        if (!symbolName || !date) {
            ws.send(JSON.stringify({ error: 'Missing symbolName or date' }));
            return;
        }
        const sanitised_SymbolName = sanitize(symbolName);
        const filePath = path.join(EXPORTED_DATA_DIR, date, `${sanitised_SymbolName}.json`);
        if (!fs.existsSync(filePath)) {
            ws.send(JSON.stringify({
                error: `Tick data not found for ${symbolName} on ${date} at ${filePath}`
            }));
            return;
        }
        try {
            const data = await getSourceData('local_file', filePath);
            if (!Array.isArray(data)) {
                ws.send(JSON.stringify({ error: `Data format error at ${filePath}: expected JSON array` }));
                return;
            }
            // The done signal carries the final mark because the streamer is the
            // only component that knows where the data actually ends; downstream
            // consumers force-close open positions at this price.
            let lastLtp = null;
            let lastTickAt = null;
            const pace = typeof time_ms === 'number' && time_ms > 0;

            for (const item of data) {
                ws.send(JSON.stringify(item));
                const ltp = extractLtp(item);
                if (ltp != null) {
                    // Both come from the same tick: a price paired with an older
                    // tick's time would date the force-close wrongly, so a tick
                    // without a usable time reports none and lets the consumer
                    // fall back to what it already knows.
                    lastLtp = ltp;
                    lastTickAt = extractTickTimeMs(item);
                }
                if (pace) {
                    await new Promise(res => setTimeout(res, time_ms));
                }
            }

            console.log(
                `Finished streaming ${data.length} ticks for ${symbolName} on ${date}; ` +
                `last_ltp=${lastLtp} last_tick_at=${lastTickAt}`
            );
            ws.send(JSON.stringify({ done: true, last_ltp: lastLtp, last_tick_at: lastTickAt }));
        } catch (err) {
            ws.send(JSON.stringify({ error: err.message }));
        }
    });
});

console.log(`WebSocket server started on ws://localhost:${PORT}`);
console.log(`Reading exported ticks from ${EXPORTED_DATA_DIR}`);
