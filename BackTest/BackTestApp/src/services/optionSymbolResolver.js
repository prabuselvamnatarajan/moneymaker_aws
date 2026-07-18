import UserSymbol from "../models/userSymbol.js";
import { publishSymbolUpdate } from "./symbol.js";

/**
 * Round LTP to the nearest strike grid level.
 * @param {number} ltp
 * @param {number} strikePriceDiff
 * @returns {number}
 */
export const computeReferenceStrike = (ltp, strikePriceDiff) => {
  const diff = Number(strikePriceDiff);
  const price = Number(ltp);
  if (!(diff > 0) || !(price > 0)) {
    throw new Error("ltp and strike_price_diff must be positive numbers");
  }
  return Math.round(price / diff) * diff;
};

const normalizeChainItems = (rawItems) =>
  rawItems.map((item) => ({
    expiry: item.expiry,
    strike_price: item.strikePrice !== undefined ? item.strikePrice : item.strike_price,
    underlying_key: item.underlyingKey !== undefined ? item.underlyingKey : item.underlying_key,
    underlying_spot_price:
      item.underlyingSpotPrice !== undefined ? item.underlyingSpotPrice : item.underlying_spot_price,
    call_options: item.callOptions
      ? {
          instrument_key:
            item.callOptions.instrumentKey !== undefined
              ? item.callOptions.instrumentKey
              : item.callOptions.instrument_key,
          market_data: item.callOptions.marketData,
          option_greeks: item.callOptions.optionGreeks,
        }
      : item.call_options,
    put_options: item.putOptions
      ? {
          instrument_key:
            item.putOptions.instrumentKey !== undefined
              ? item.putOptions.instrumentKey
              : item.putOptions.instrument_key,
          market_data: item.putOptions.marketData,
          option_greeks: item.putOptions.optionGreeks,
        }
      : item.put_options,
  }));

export const fetchUnderlyingLtp = async (underlyingSymbol, userId) => {
  const ltpServiceUrl = process.env.GET_LTP_SERVICE_URL || "http://get-ltp:80";
  const ltpResponse = await fetch(
    `${ltpServiceUrl}/?symbol=${encodeURIComponent(underlyingSymbol)}&userId=${userId}`
  );
  if (!ltpResponse.ok) {
    throw new Error(`LTP service returned status ${ltpResponse.status}`);
  }
  const ltpData = await ltpResponse.json();
  if (ltpData.status !== "success" || !ltpData.data) {
    throw new Error("Invalid response format from LTP service");
  }
  const entries = Object.entries(ltpData.data);
  if (entries.length === 0) {
    throw new Error(`Symbol ${underlyingSymbol} not found in LTP service`);
  }
  const val = entries[0][1];
  const ltp = val.last_price || val.lastPrice;
  if (!ltp) {
    throw new Error(`Could not retrieve LTP for underlying symbol ${underlyingSymbol}`);
  }
  return ltp;
};

export const fetchOptionChain = async (underlyingSymbol, userId, expiry = "current_week") => {
  const optionChainServiceUrl =
    process.env.GET_OPTION_CHAIN_SERVICE_URL || "http://get-put-call-option-chain:80";
  const optionChainResponse = await fetch(
    `${optionChainServiceUrl}/?symbol=${encodeURIComponent(underlyingSymbol)}&expiry=${encodeURIComponent(expiry || "current_week")}&userId=${userId}`
  );
  if (!optionChainResponse.ok) {
    throw new Error(`Option chain service returned status ${optionChainResponse.status}`);
  }
  const optionChainData = await optionChainResponse.json();
  if (optionChainData.status !== "success" || !Array.isArray(optionChainData.data)) {
    throw new Error("Invalid response format from Option Chain service");
  }
  const chainItems = normalizeChainItems(optionChainData.data);
  if (chainItems.length === 0) {
    throw new Error(`No option contracts found in the option chain for ${underlyingSymbol}`);
  }
  return chainItems;
};

/**
 * Select option chain rows by moneyness relative to ATM (closest strike to LTP).
 * @returns {{ selectedStrikesCE: Array, selectedStrikesPE: Array, atmStrike: number }}
 */
export const selectStrikesByMoneyness = (chainItems, ltp, rangeOption, rangeCount = 1) => {
  let atmStrike = null;
  let minDiff = Infinity;
  for (const item of chainItems) {
    const diff = Math.abs(item.strike_price - ltp);
    if (diff < minDiff) {
      minDiff = diff;
      atmStrike = item.strike_price;
    }
  }

  const sortedItems = [...chainItems].sort((a, b) => a.strike_price - b.strike_price);
  const ceItmItems = sortedItems
    .filter((item) => item.strike_price < atmStrike && item.call_options)
    .reverse();
  const ceOtmItems = sortedItems.filter(
    (item) => item.strike_price > atmStrike && item.call_options
  );
  const peItmItems = sortedItems.filter(
    (item) => item.strike_price > atmStrike && item.put_options
  );
  const peOtmItems = sortedItems
    .filter((item) => item.strike_price < atmStrike && item.put_options)
    .reverse();
  const atmItem = sortedItems.find((item) => item.strike_price === atmStrike);

  let selectedStrikesCE = [];
  let selectedStrikesPE = [];
  const count = parseInt(rangeCount, 10) || 1;

  if (rangeOption === "ATM") {
    if (atmItem) {
      if (atmItem.call_options) selectedStrikesCE.push(atmItem);
      if (atmItem.put_options) selectedStrikesPE.push(atmItem);
    }
  } else if (rangeOption === "ITM") {
    selectedStrikesCE = ceItmItems.slice(0, count);
    selectedStrikesPE = peItmItems.slice(0, count);
  } else if (rangeOption === "OTM") {
    selectedStrikesCE = ceOtmItems.slice(0, count);
    selectedStrikesPE = peOtmItems.slice(0, count);
  } else if (rangeOption === "ALL") {
    if (atmItem) {
      if (atmItem.call_options) selectedStrikesCE.push(atmItem);
      if (atmItem.put_options) selectedStrikesPE.push(atmItem);
    }
    selectedStrikesCE = [
      ...selectedStrikesCE,
      ...ceItmItems.slice(0, count),
      ...ceOtmItems.slice(0, count),
    ];
    selectedStrikesPE = [
      ...selectedStrikesPE,
      ...peItmItems.slice(0, count),
      ...peOtmItems.slice(0, count),
    ];
  } else {
    throw new Error(`Unsupported range_option: ${rangeOption}`);
  }

  return { selectedStrikesCE, selectedStrikesPE, atmStrike };
};

const formatSymbolName = (underlying, strike, type, expiry) => {
  const cleanUnderlying = underlying.includes("|") ? underlying.split("|")[1] : underlying;
  const cleanExpiry = expiry && expiry.includes("T") ? expiry.split("T")[0] : expiry;
  return `${cleanUnderlying} ${cleanExpiry || ""} ${strike} ${type}`;
};

/**
 * Ensure a UserSymbol exists for an option instrument; activate + subscribe if needed.
 */
export const ensureOptionUserSymbol = async (
  userId,
  underlyingSymbol,
  optionData,
  strikePrice,
  expiryDate,
  typeLabel
) => {
  const instrumentToken = optionData.instrument_key;
  let existing = await UserSymbol.findOne({ user_id: userId, instrument_token: instrumentToken });
  if (!existing) {
    const symbol_name = formatSymbolName(underlyingSymbol, strikePrice, typeLabel, expiryDate);
    existing = await new UserSymbol({
      user_id: userId,
      instrument_token: instrumentToken,
      symbol: instrumentToken,
      symbol_name,
      exchange: "NFO",
      instrument_class: "OPTION",
      description: `${underlyingSymbol} ${typeLabel} Option Contract`,
      is_active: true,
    }).save();
    try {
      await publishSymbolUpdate({
        action: "subscribe",
        instrument_token: existing.instrument_token,
        userId,
      });
    } catch (e) {
      console.error("Failed to publish symbol subscribe for option symbol:", e);
    }
  } else if (!existing.is_active) {
    existing.is_active = true;
    await existing.save();
    try {
      await publishSymbolUpdate({
        action: "subscribe",
        instrument_token: existing.instrument_token,
        userId,
      });
    } catch (e) {
      console.error("Failed to publish symbol subscribe for reactivated option:", e);
    }
  }

  return {
    user_symbol_id: existing._id,
    instrument_token: existing.instrument_token,
    symbol: existing.symbol,
    symbol_name: existing.symbol_name,
    strike_price: strikePrice,
    option_type: typeLabel,
    expiry: expiryDate,
  };
};

/**
 * Resolve a single option contract for a controlled deployment.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.underlyingSymbol - instrument token / key of underlying
 * @param {"ITM"|"ATM"|"OTM"} opts.moneyness
 * @param {number} opts.offset - 1 = nearest ITM/OTM
 * @param {"CE"|"PE"} opts.optionType
 * @param {string} [opts.expiry]
 * @param {number} [opts.ltp] - optional tick LTP; otherwise fetched via LTP service
 */
export const resolveOptionSymbol = async ({
  userId,
  underlyingSymbol,
  moneyness,
  offset = 1,
  optionType,
  expiry = "current_week",
  ltp: providedLtp,
}) => {
  if (!underlyingSymbol || !moneyness || !optionType) {
    throw new Error("underlyingSymbol, moneyness, and optionType are required");
  }
  const side = String(optionType).toUpperCase();
  if (side !== "CE" && side !== "PE") {
    throw new Error("optionType must be CE or PE");
  }

  const ltp = providedLtp != null ? Number(providedLtp) : await fetchUnderlyingLtp(underlyingSymbol, userId);
  if (!(ltp > 0)) {
    throw new Error("Invalid LTP for option resolution");
  }

  const chainItems = await fetchOptionChain(underlyingSymbol, userId, expiry);
  const { selectedStrikesCE, selectedStrikesPE, atmStrike } = selectStrikesByMoneyness(
    chainItems,
    ltp,
    String(moneyness).toUpperCase(),
    offset
  );

  const selected =
    side === "CE" ? selectedStrikesCE[0] : selectedStrikesPE[0];
  if (!selected) {
    throw new Error(
      `No ${side} contract found for ${moneyness}-${offset} of ${underlyingSymbol} (ATM=${atmStrike})`
    );
  }

  const optionData = side === "CE" ? selected.call_options : selected.put_options;
  if (!optionData?.instrument_key) {
    throw new Error(`Selected ${side} option missing instrument_key`);
  }

  const ensured = await ensureOptionUserSymbol(
    userId,
    underlyingSymbol,
    optionData,
    selected.strike_price,
    selected.expiry,
    side
  );

  return {
    ...ensured,
    atm_strike: atmStrike,
    ltp,
    reference_strike: atmStrike,
  };
};

/**
 * Bulk-select option contracts (used by bulkCreateSymbols).
 * Returns chain selection only; persistence is handled by caller via ensureOptionUserSymbol.
 */
export const resolveBulkOptionSelections = async ({
  userId,
  underlyingSymbol,
  range_count,
  range_option,
  option_type,
  expiry,
}) => {
  if (!underlyingSymbol || !range_option || !option_type) {
    throw new Error("underlyingSymbol, range_option, and option_type are required");
  }

  const ltp = await fetchUnderlyingLtp(underlyingSymbol, userId);
  const chainItems = await fetchOptionChain(underlyingSymbol, userId, expiry || "current_week");
  const { selectedStrikesCE, selectedStrikesPE, atmStrike } = selectStrikesByMoneyness(
    chainItems,
    ltp,
    range_option,
    range_count
  );

  return {
    ltp,
    atmStrike,
    selectedStrikesCE,
    selectedStrikesPE,
    option_type,
  };
};
