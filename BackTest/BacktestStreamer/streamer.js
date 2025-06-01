const WebSocket = require('ws');
const path = require('path');
const { getSourceData } = require('./sourceRetriever');

// Assign env variables to constants
const PORT = process.env.PORT || 8085;
const SHARED_DIR = process.env.SHARED_DIR || path.join(__dirname, '..');

const wss = new WebSocket.Server({ port: PORT });

function sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9]/g, '_');
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
        let sanitised_SymbolName = sanitize(symbolName);
        const filePath = path.join(SHARED_DIR, 'exportedData', date, `${sanitised_SymbolName}.json`);
        try {
            const data = await getSourceData('local_file', filePath);
            if (!Array.isArray(data)) {
                ws.send(JSON.stringify({ error: 'Data format error' }));
                return;
            }
            // Stream data one by one
            if (typeof time_ms === 'number' && time_ms > 0) {
                for (const item of data) {
                    ws.send(JSON.stringify(item));
                    await new Promise(res => setTimeout(res, time_ms));
                }
            } else {
                for (const item of data) {
                    ws.send(JSON.stringify(item));
                }
            }
            ws.send(JSON.stringify({ done: true }));
        } catch (err) {
            ws.send(JSON.stringify({ error: err.message }));
        }
    });
});

console.log(`WebSocket server started on ws://localhost:${PORT}`);
