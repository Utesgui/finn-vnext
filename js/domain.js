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
      priceMin: null, priceMax: null, powerMin: 0, powerMax: null, rangeMin: 0,
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

  const PRICE_SNAPSHOT_KEY = /^(?:b2[bc]|extra)_\d+$/;

  /* Monthly rates and mileage fees in a stable key order; null without a rate. */
  function normalizePriceSnapshot(price) {
    if (!price || typeof price !== "object") return null;
    const output = {};
    for (const key of Object.keys(price).sort()) {
      const value = price[key];
      if (PRICE_SNAPSHOT_KEY.test(key) && typeof value === "number" && Number.isFinite(value) && value >= 0) output[key] = value;
    }
    return Object.keys(output).some(key => key.startsWith("b2")) ? output : null;
  }

  /* Adds one observation to a change-only history without mutating it. Used by
     the snapshot bot and, for the session's live catalog, by the browser. */
  function recordPriceObservation(history, rawPrice, ts) {
    const price = normalizePriceSnapshot(rawPrice);
    if (!price) return history || null;
    if (!history) return { firstSeen: ts, lastSeen: ts, changes: [{ t: ts, price }] };
    if (ts <= history.lastSeen) return history;
    const last = history.changes[history.changes.length - 1];
    const unchanged = last && JSON.stringify(last.price) === JSON.stringify(price);
    return {
      firstSeen: history.firstSeen,
      lastSeen: ts,
      changes: unchanged ? history.changes : [...history.changes, { t: ts, price }]
    };
  }

  function historyBuckets(granularity, now, count) {
    const year = now.getFullYear();
    const month = now.getMonth();
    const date = now.getDate();
    const size = granularity === "week" ? 7 : 1;
    const anchor = granularity === "week" ? date - (now.getDay() + 6) % 7 : date; // Monday-based weeks
    const buckets = [];
    for (let index = count - 1; index >= 0; index--) {
      const offset = anchor - index * size;
      buckets.push({
        start: new Date(year, month, offset).getTime(),
        end: new Date(year, month, offset + size).getTime(),
        price: null
      });
    }
    return buckets;
  }

  function summarizeBuckets(buckets) {
    const values = buckets.filter(bucket => bucket.price != null).map(bucket => bucket.price);
    if (!values.length) return { current: null, low: null, high: null, delta: null };
    const current = values[values.length - 1];
    return { current, low: Math.min(...values), high: Math.max(...values), delta: current - values[0] };
  }

  /* Rebuilds a chart series from stored price snapshots. Each snapshot is run
     through minPrice, so the history honours the selected term, mileage and
     pricing mode exactly like the live price. A bucket holds its closing price. */
  function priceHistorySeries(history, options = {}) {
    const granularity = options.granularity === "week" ? "week" : "day";
    const count = options.count || (granularity === "week" ? 26 : 30);
    const now = options.now instanceof Date ? options.now : new Date();
    const terms = Array.isArray(options.terms) && options.terms.length
      ? options.terms.map(Number)
      : options.term ? [Number(options.term)] : null;
    const entries = ((history && history.changes) || [])
      .map(entry => ({
        t: Number(entry.t),
        price: minPrice({ price: entry.price }, { km: options.km, business: options.business, terms })
      }))
      .filter(entry => Number.isFinite(entry.t))
      .sort((a, b) => a.t - b.t);
    const lastSeen = history ? Number(history.lastSeen) : NaN;
    const buckets = historyBuckets(granularity, now, count);
    for (const bucket of buckets) {
      if (Number.isFinite(lastSeen) && bucket.start > lastSeen) continue;
      const cutoff = Math.min(bucket.end - 1, now.getTime());
      for (const entry of entries) {
        if (entry.t > cutoff) break;
        bucket.price = entry.price;
      }
    }
    const windowStart = buckets[0].start;
    const changes = [];
    let previous = null;
    for (const entry of entries) {
      if (entry.price == null) continue;
      if (previous != null && entry.price !== previous && entry.t >= windowStart) {
        changes.push({ t: entry.t, from: previous, to: entry.price, delta: entry.price - previous });
      }
      previous = entry.price;
    }
    changes.reverse();
    return { granularity, buckets, changes, ...summarizeBuckets(buckets) };
  }

  /* Model cards advertise the cheapest version, so their trend follows it too. */
  function lowestHistorySeries(seriesList) {
    if (!seriesList.length) return null;
    const buckets = seriesList[0].buckets.map((bucket, index) => {
      const prices = seriesList.map(series => series.buckets[index].price).filter(price => price != null);
      return { ...bucket, price: prices.length ? Math.min(...prices) : null };
    });
    return { granularity: seriesList[0].granularity, buckets, changes: [], ...summarizeBuckets(buckets) };
  }

  /* Whole-euro y-axis around the observed range; flat prices still get a band. */
  function historyAxis(low, high) {
    const padding = Math.max((high - low) * 0.15, Math.abs(high) * 0.02, 5);
    const lower = low - padding;
    const upper = high + padding;
    const rough = (upper - lower) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough);
    const min = Math.max(0, Math.floor(lower / step) * step);
    const max = Math.ceil(upper / step) * step;
    const ticks = [];
    for (let tick = min; tick <= max; tick += step) ticks.push(tick);
    return { min, max, ticks };
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
    if (filters.powerMax != null) params.set("powx", filters.powerMax);
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
    const powx = finiteOr("powx", null);
    filters.powerMax = powx != null && powx > 0 ? powx : null;
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
    normalizePriceSnapshot,
    recordPriceObservation,
    priceHistorySeries,
    lowestHistorySeries,
    historyAxis,
    encodeViewState,
    decodeViewState
  };
});
