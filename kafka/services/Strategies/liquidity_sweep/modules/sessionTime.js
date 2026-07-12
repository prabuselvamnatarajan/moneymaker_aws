const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toISTParts(timestamp) {
    const ist = new Date(timestamp + IST_OFFSET_MS);
    return {
        year: ist.getUTCFullYear(),
        month: ist.getUTCMonth(),
        date: ist.getUTCDate(),
        hours: ist.getUTCHours(),
        minutes: ist.getUTCMinutes(),
    };
}

function istWallClockToEpochMs(year, month, date, hours, minutes) {
    return Date.UTC(year, month, date, hours, minutes, 0, 0) - IST_OFFSET_MS;
}

function getSessionDate(timestamp) {
    const { year, month, date } = toISTParts(timestamp);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

function getSessionOpenTs(timestamp) {
    const { year, month, date } = toISTParts(timestamp);
    return istWallClockToEpochMs(year, month, date, 9, 15);
}

function getSessionEndTs(timestamp, hour, minute) {
    const { year, month, date } = toISTParts(timestamp);
    return istWallClockToEpochMs(year, month, date, hour, minute);
}

export {
    getSessionDate,
    getSessionOpenTs,
    getSessionEndTs,
    toISTParts,
};
