
class RedisJson {
    constructor(client) {
        this.client = client;
    }

    // Use RedisJSON for set
    async setJson(key, data) {
        try {
            // Use JSON.SET if available (ReJSON), else fallback to SET
            if (typeof this.client.sendCommand === 'function') {
                // RedisJSON expects path as '.' for root
                const result = await this.client.sendCommand(['JSON.SET', key, '.', JSON.stringify(data)]);
                console.log(`JSON.SET result for ${key}:`, result);
                return result;
            } else if (typeof this.client.json?.set === 'function') {
                // node-redis v4+ with RedisJSON
                const result = await this.client.json.set(key, '.', data);
                console.log(`client.json.set result for ${key}:`, result);
                return result;
            } else {
                // Fallback to standard SET
                const jsonData = JSON.stringify(data);
                const result = await this.client.set(key, jsonData);
                console.log(`SET result for ${key}:`, result);
                return result;
            }
        } catch (error) {
            console.log("Error setting JSON data:", error);
            return null;
        }
    }

    // Use RedisJSON for get
    async getJson(key) {
        try {
            // Detect type first
            let type = null;
            if (typeof this.client.type === 'function') {
                type = await this.client.type(key);
            }

            // Use JSON.GET if type is ReJSON-RL or if client supports it
            if (type === 'ReJSON-RL' || typeof this.client.sendCommand === 'function') {
                let jsonData = null;
                try {
                    jsonData = await this.client.sendCommand(['JSON.GET', key]);
                } catch (err) {
                    console.log(`Error with JSON.GET for ${key}:`, err);
                    return null;
                }
                if (!jsonData) return null;
                try {
                    return JSON.parse(jsonData);
                } catch (err) {
                    console.log(`Error parsing JSON.GET result for ${key}:`, err);
                    return null;
                }
            } else if (typeof this.client.json?.get === 'function') {
                // node-redis v4+ with RedisJSON
                const result = await this.client.json.get(key, { path: '.' });
                return result ?? null;
            } else {
                // Fallback to standard GET
                const jsonData = await this.client.get(key);
                if (!jsonData) return null;
                try {
                    return JSON.parse(jsonData);
                } catch (err) {
                    console.log(`Error parsing GET result for ${key}:`, err);
                    return null;
                }
            }
        } catch (error) {
            console.log("Error getting JSON data:", error);
            return null;
        }
    }

    // Update a field in a JSON object (RedisJSON only)
    async updateJsonField(key, fieldPath, value) {
        try {
            // Use JSON.SET with path if available
            if (typeof this.client.sendCommand === 'function') {
                const result = await this.client.sendCommand(['JSON.SET', key, `.${fieldPath}`, JSON.stringify(value)]);
                console.log(`JSON.SET field ${fieldPath} for ${key}:`, result);
                return result;
            } else if (typeof this.client.json?.set === 'function') {
                const result = await this.client.json.set(key, `.${fieldPath}`, value);
                console.log(`client.json.set field ${fieldPath} for ${key}:`, result);
                return result;
            } else {
                // Fallback: get, update, set whole object
                const existingData = await this.getJson(key);
                if (!existingData) {
                    console.log(`Key ${key} does not exist. Cannot update field.`);
                    return null;
                }
                let current = existingData;
                const pathParts = fieldPath.split(".");
                for (let i = 0; i < pathParts.length - 1; i++) {
                    const part = pathParts[i];
                    if (typeof current[part] !== "object" || current[part] === null) {
                        current[part] = {};
                    }
                    current = current[part];
                }
                current[pathParts[pathParts.length - 1]] = value;
                return await this.setJson(key, existingData);
            }
        } catch (error) {
            console.error("Error updating JSON field:", error);
            return null;
        }
    }

    async deleteJson(key) {
        // Use JSON.DEL if available, else DEL
        try {
            if (typeof this.client.sendCommand === 'function') {
                const result = await this.client.sendCommand(['JSON.DEL', key]);
                console.log(`JSON.DEL result for ${key}:`, result);
                return result;
            } else if (typeof this.client.json?.del === 'function') {
                const result = await this.client.json.del(key);
                console.log(`client.json.del result for ${key}:`, result);
                return result;
            } else {
                return await this.client.del(key);
            }
        } catch (error) {
            console.error("Error deleting JSON key:", error);
            return null;
        }
    }
}

export default RedisJson;

