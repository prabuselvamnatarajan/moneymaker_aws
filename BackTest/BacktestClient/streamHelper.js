function sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function validateStreamQuery(query) {
    const { symbolName, date, time_ms, deployment_id, run_id } = query || {};
    if (!symbolName || !date) {
        return { error: 'Missing symbolName or date', status: 400 };
    }

    let timeMsNum = 0;
    if (time_ms !== undefined) {
        timeMsNum = Number(time_ms);
        if (isNaN(timeMsNum) || timeMsNum < 0) {
            return { error: 'Invalid time_ms: must be a number >= 0', status: 400 };
        }
    }

    const partitionKey = `backtest-${sanitize(symbolName)}-${sanitize(date)}-${sanitize(timeMsNum)}`;
    return {
        value: {
            symbolName,
            date,
            timeMsNum,
            deployment_id,
            run_id,
            partitionKey,
        },
        status: 200,
    };
}

function appendMetadataToTick(rawMessage, deployment_id, run_id) {
    let msgStr = rawMessage.toString();
    if (deployment_id) {
        try {
            const parsed = JSON.parse(msgStr);
            parsed.deployment_id = deployment_id;
            if (run_id) {
                parsed.run_id = run_id;
            }
            msgStr = JSON.stringify(parsed);
        } catch (err) {
            // Forward as-is if parsing fails
        }
    }
    return msgStr;
}

module.exports = {
    sanitize,
    validateStreamQuery,
    appendMetadataToTick,
};
