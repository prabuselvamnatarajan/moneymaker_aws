
async function getOrderBook(access_token)
{
    const url = `https://api.upstox.com/v2/order/retrieve-all`;
    const headers = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${access_token}`
    };

    try {
        const response = fetch(url, {
            method: 'GET',
            headers: headers
        }).then(res => res.json()).then(data => {
            console.log('Response:', data);
            return data;
        }).catch(error => {console.error('Error:', error);});
        return response;
    } catch (err) {
        console.error('Error:', err);
        throw new Error('Failed to Retrieve Order Book ...');
    }
}

module.exports = {
    getOrderBook
};