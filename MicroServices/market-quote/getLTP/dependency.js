const base_url = 'https://api.upstox.com/v2';

async function getLTP(access_token, symbol) {
    const url = `${base_url}/market-quote/ltp?instrument_key=${symbol}`;
    const headers = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${access_token}`
    };

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching LTP:', error);
        throw error;
    }
}

module.exports = {
    getLTP
};