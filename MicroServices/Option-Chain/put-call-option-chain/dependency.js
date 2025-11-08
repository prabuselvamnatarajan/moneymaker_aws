const base_url = 'https://api.upstox.com/v2';

async function getPutCallOptionChain(access_token, symbol, expiry_date) {
    const url = `${base_url}/option/chain?instrument_key=${symbol}&expiry_date=${expiry_date}`;
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
    getPutCallOptionChain
};