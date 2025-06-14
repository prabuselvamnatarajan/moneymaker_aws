class RedisJson {
    constructor(client) {
        this.client = client;
    }

    async setJson(key, data) {
        try {
            const jsonData = JSON.stringify(data);
            return await this.client.set(key, jsonData);
        } catch (error) {
            console.error("Error setting JSON data:", error);
            return null;
        }
    }

    async getJson(key) {
        try {
            const jsonData = await this.client.get(key);
            return jsonData ? JSON.parse(jsonData) : null;
        } catch (error) {
            console.error("Error getting JSON data:", error);
            return null;
        }
    }

    async updateJsonField(key, fieldPath, value) {
        try {
            const existingData = await this.getJson(key);
            if (!existingData) {
                console.warn(`Key ${key} does not exist. Cannot update field.`);
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
        } catch (error) {
            console.error("Error updating JSON field:", error);
            return null;
        }
    }

    async deleteJson(key) {
        return await this.client.del(key);
    }
}

export default RedisJson;

