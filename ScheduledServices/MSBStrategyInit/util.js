require('dotenv').config();

const GET_LTP_URL = process.env.GET_LTP_URL;


async function getLTP({ symbol }) {
    if (!symbol) {
        throw new Error('Symbol is required');
    }
    let url = `${GET_LTP_URL}?symbol=${symbol}`;
    try {
        const response = await fetch(url, {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        let ltp = Object.values(response.data)[0].last_price;
        return ltp;
    } catch (error) {
        console.error('Error fetching LTP:', error);
        throw error;
    }
}

async function getRelatedStrikePrices( currentSpotPrice, spotDiff = 50, noOfRelatedEntries = 5) {
    const CallLastInTheMoney = Math.floor(currentSpotPrice / spotDiff) * spotDiff;
    
    const relatedStrikePrices = [];
    
    for (let i = noOfRelatedEntries; i > 0; i--) {
        relatedStrikePrices.push(CallLastInTheMoney - (i * spotDiff));
    }

    relatedStrikePrices.push(CallLastInTheMoney);
    
    for (let i = 1; i <= noOfRelatedEntries; i++) {
        relatedStrikePrices.push(CallLastInTheMoney + (i * spotDiff));
    }
    
    console.log("Related Strike Prices:", relatedStrikePrices);
    
    // Array 1st 5 index are CE ITM, PE OTM  ----  last 5 index are CE OTM, PE ITM
    return relatedStrikePrices;
}

async function getRelatedOptionContracts({ fulloptionchain, relatedStrikePrices = [] }) {
    if (!Array.isArray(fulloptionchain)) {
        throw new Error("Expected fulloptionchain to be an array");
    }
    console.log(relatedStrikePrices);
    const relatedOptionContracts = fulloptionchain.filter(option => {
        return relatedStrikePrices.includes(option.strike_price);
    });

    //console.log("Related Option Contracts:", relatedOptionContracts);

    return relatedOptionContracts;
} 

module.exports = {
    getLTP,
    getRelatedStrikePrices,
    getRelatedOptionContracts
};