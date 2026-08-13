"use strict";

(function exposeDomain(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FinnDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDomain() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LIST_FILTER_KEYS = [
    ["fu", "fuels"], ["br", "brands"], ["ty", "types"], ["ge", "gears"],
    ["te", "terms"], ["se", "seats"], ["do", "doors"], ["co", "colors"]
  ];
  const SORT_KEYS = new Set(["reco", "added-desc", "price-asc", "price-desc", "drop-desc", "power-desc", "range-desc", "avail-asc", "name-asc"]);
  const MILEAGE_PACKAGES = new Set([500, 1000, 1500, 2000, 2500, 3000, 3500]);

  function freshFilters() {
    return {
      q: "", fuels: [], brands: [], types: [], gears: [], terms: [], seats: [], doors: [], colors: [],
      priceMin: null, priceMax: null, powerMin: 0, rangeMin: 0,
      deals: false, hitch: false, soon: false, realPics: false, drops: false, favOnly: false
    };
  }

  const isNeg = value => typeof value === "string" && value.startsWith("!");

  function facetPass(entries, value) {
    if (!entries.length) return true;
    const normalized = String(value ?? "");
    let hasInclude = false;
    let included = false;
    for (const entry of entries) {
      if (isNeg(entry)) {
        if (entry.slice(1) === normalized) return false;
      } else {
        hasInclude = true;
        if (entry === normalized) included = true;
      }
    }
    return !hasInclude || included;
  }

  function cycleFacet(entries, value) {
    const included = entries.indexOf(value);
    const excluded = entries.indexOf("!" + value);
    if (included < 0 && excluded < 0) entries.push(value);
    else if (included >= 0) {
      entries.splice(included, 1);
      entries.push("!" + value);
    } else entries.splice(excluded, 1);
    return entries;
  }

  function stockCount(car) {
    const visibleRaw = car && car.product_stock_webflow;
    const visible = Number(visibleRaw);
    if (visibleRaw != null && visibleRaw !== "" && Number.isFinite(visible) && visible >= 0) return visible;
    const totalRaw = car && car.product_stock_total;
    const total = Number(totalRaw);
    return totalRaw != null && totalRaw !== "" && Number.isFinite(total) && total >= 0 ? total : null;
  }

  function aggregateStock(cars) {
    let known = false;
    let total = 0;
    for (const car of cars || []) {
      const count = stockCount(car);
      if (count == null) continue;
      known = true;
      total += count;
    }
    return known ? total : null;
  }

  function kmPackages(car) {
    const price = car && car.price || {};
    return Object.keys(price)
      .filter(key => /^extra_\d+$/.test(key))
      .map(key => ({ km: Number(key.slice(6)), fee: Number(price[key]) }))
      .filter(entry => Number.isFinite(entry.km) && entry.km > 0 && Number.isFinite(entry.fee))
      .sort((a, b) => a.km - b.km);
  }

  function kmFeeFor(car, km) {
    const price = car && car.price || {};
    const raw = price["extra_" + km];
    const exact = Number(raw);
    if (raw != null && raw !== "" && Number.isFinite(exact)) return exact;
    const packages = kmPackages(car);
    if (!packages.length) return 0;
    let best = null;
    for (const entry of packages) {
      if (entry.km <= km && (best == null || entry.km > best.km)) best = entry;
    }
    return (best || packages[0]).fee || 0;
  }

  function priceList(car, options = {}) {
    const km = Number(options.km) || 500;
    const business = options.business !== false;
    const price = car && car.price || {};
    const kmFee = kmFeeFor(car, km);
    const terms = new Set((Array.isArray(car && car.available_terms) ? car.available_terms : []).map(Number));
    Object.keys(price).forEach(key => {
      const match = key.match(/^b2[bc]_(\d+)$/);
      if (match) terms.add(Number(match[1]));
    });
    const preferred = business ? "b2b_" : "b2c_";
    const alternate = business ? "b2c_" : "b2b_";
    const output = [];
    for (const term of terms) {
      if (!Number.isFinite(term) || term <= 0) continue;
      let value = Number(price[preferred + term]);
      if (!Number.isFinite(value) || value <= 0) value = Number(price[alternate + term]);
      if (Number.isFinite(value) && value > 0) output.push({ term, price: value + kmFee });
    }
    if (!output.length && price.available_price_list && typeof price.available_price_list === "object") {
      for (const [key, value] of Object.entries(price.available_price_list)) {
        const term = Number.parseInt(key, 10);
        const amount = Number(value);
        if (Number.isFinite(term) && term > 0 && Number.isFinite(amount) && amount > 0) {
          output.push({ term, price: amount + kmFee });
        }
      }
    }
    return output.sort((a, b) => a.term - b.term);
  }

  function minPrice(car, options = {}) {
    const selectedTerms = Array.isArray(options.terms) ? options.terms.map(Number) : null;
    let prices = priceList(car, options);
    if (selectedTerms && selectedTerms.length) prices = prices.filter(entry => selectedTerms.includes(entry.term));
    return prices.length ? Math.min(...prices.map(entry => entry.price)) : null;
  }

  function parseAvailableDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : new Date(raw.getTime());
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function calendarDay(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
  }

  function availabilityInfo(raw, now = new Date()) {
    const date = parseAvailableDate(raw);
    if (!date) return { date: null, days: null, availableNow: false, soon: false };
    const days = calendarDay(date) - calendarDay(now);
    return { date, days, availableNow: days <= 0, soon: days <= 28 };
  }

  function encodeViewState({ filters = freshFilters(), km = 500, browseMode = "cars", sort = "reco" } = {}) {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    for (const [param, property] of LIST_FILTER_KEYS) {
      const values = filters[property];
      if (Array.isArray(values) && values.length) params.set(param, values.join(","));
    }
    if (filters.priceMin != null) params.set("pmin", filters.priceMin);
    if (filters.priceMax != null) params.set("pmax", filters.priceMax);
    if (filters.powerMin > 0) params.set("pow", filters.powerMin);
    if (filters.rangeMin > 0) params.set("rng", filters.rangeMin);
    if (filters.deals) params.set("deals", "1");
    if (filters.hitch) params.set("ahk", "1");
    if (filters.soon) params.set("soon", "1");
    if (filters.realPics) params.set("pics", "1");
    if (filters.drops) params.set("dr", "1");
    if (filters.favOnly) params.set("fav", "1");
    if (MILEAGE_PACKAGES.has(Number(km)) && Number(km) !== 500) params.set("km", km);
    if (browseMode === "models") params.set("group", "1");
    if (SORT_KEYS.has(sort) && sort !== "reco") params.set("sort", sort);
    return params.toString();
  }

  function decodeViewState(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    const filters = freshFilters();
    if (!raw) return { hasState: false, filters, km: null, browseMode: null, sort: null };
    const params = new URLSearchParams(raw);
    const list = key => (params.get(key) || "").split(",").filter(Boolean);
    const finiteOr = (key, fallback) => {
      if (!params.has(key)) return fallback;
      const value = Number(params.get(key));
      return Number.isFinite(value) ? value : fallback;
    };
    filters.q = params.get("q") || "";
    for (const [param, property] of LIST_FILTER_KEYS) filters[property] = list(param);
    filters.priceMin = finiteOr("pmin", null);
    filters.priceMax = finiteOr("pmax", null);
    filters.powerMin = Math.max(0, finiteOr("pow", 0));
    filters.rangeMin = Math.max(0, finiteOr("rng", 0));
    filters.deals = params.get("deals") === "1";
    filters.hitch = params.get("ahk") === "1";
    filters.soon = params.get("soon") === "1";
    filters.realPics = params.get("pics") === "1";
    filters.drops = params.get("dr") === "1";
    filters.favOnly = params.get("fav") === "1";
    const mileage = Number(params.get("km"));
    const sort = params.get("sort");
    return {
      hasState: [...params.keys()].length > 0,
      filters,
      km: MILEAGE_PACKAGES.has(mileage) ? mileage : null,
      browseMode: params.get("group") === "1" ? "models" : null,
      sort: SORT_KEYS.has(sort) ? sort : null
    };
  }

  return {
    freshFilters,
    isNeg,
    facetPass,
    cycleFacet,
    stockCount,
    aggregateStock,
    kmPackages,
    kmFeeFor,
    priceList,
    minPrice,
    parseAvailableDate,
    availabilityInfo,
    encodeViewState,
    decodeViewState
  };
});
