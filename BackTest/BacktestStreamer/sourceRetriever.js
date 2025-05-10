const fs = require('fs').promises;

async function getSourceData(source, filePath) {
    if (source !== 'local_file') {
        throw new Error('Unsupported source');
    }
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
}

module.exports = { getSourceData };
