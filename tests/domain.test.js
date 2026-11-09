"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const domain = require("../js/domain.js");

test("tri-state facets cycle off, include, exclude, off", () => {
  const values = [];
  domain.cycleFacet(values, "Audi");
  assert.deepEqual(values, ["Audi"]);
  domain.cycleFacet(values, "Audi");
  assert.deepEqual(values, ["!Audi"]);
  domain.cycleFacet(values, "Audi");
  assert.deepEqual(values, []);
});

test("facetPass combines includes and excludes", () => {
  assert.equal(domain.facetPass([], "Audi"), true);
  assert.equal(domain.facetPass(["Audi"], "Audi"), true);
  assert.equal(domain.facetPass(["Audi"], "BMW"), false);
  assert.equal(domain.facetPass(["!Audi"], "BMW"), true);
  assert.equal(domain.facetPass(["!Audi"], "Audi"), false);
});

test("availability only calls today or past dates available now", () => {
  const now = new Date(2026, 6, 31, 15, 0, 0);
  assert.equal(domain.availabilityInfo("2026-07-30", now).availableNow, true);
  assert.equal(domain.availabilityInfo("2026-07-31", now).availableNow, true);
  assert.equal(domain.availabilityInfo("2026-08-01", now).availableNow, false);
  assert.equal(domain.availabilityInfo("2026-08-10", now).availableNow, false);
  assert.equal(domain.availabilityInfo("2026-08-28", now).soon, true);
  assert.equal(domain.availabilityInfo("2026-08-29", now).soon, false);
});

test("stock prefers storefront units and falls back to total", () => {
  assert.equal(domain.stockCount({ product_stock_webflow: 4, product_stock_total: 9 }), 4);
  assert.equal(domain.stockCount({ product_stock_webflow: null, product_stock_total: 9 }), 9);
  assert.equal(domain.stockCount({ product_stock_webflow: "", product_stock_total: 3 }), 3);
  assert.equal(domain.stockCount({}), null);
  assert.equal(domain.aggregateStock([{ product_stock_webflow: 2 }, { product_stock_total: 3 }]), 5);
});

test("price calculation applies mileage fees and pricing mode", () => {
  const car = {
    available_terms: [12, 24],
    price: { b2b_12: 400, b2b_24: 350, b2c_12: 480, b2c_24: 420, extra_500: 0, extra_1000: 30 }
  };
  assert.deepEqual(domain.priceList(car, { km: 1000, business: true }), [
    { term: 12, price: 425 },
    { term: 24, price: 375 }
  ]);
  assert.equal(domain.minPrice(car, { km: 1000, business: false }), 450);
  assert.equal(domain.minPrice(car, { km: 500, business: true, terms: [12] }), 400);
});

test("mileage fees are gross and converted to rounded net for business", () => {
  const car = { price: { b2b_12: 1323, b2c_12: 1574, extra_500: 0, extra_1000: 59, extra_2000: 579 } };
  assert.equal(domain.minPrice(car, { km: 1000, business: true }), 1323 + 50);
  assert.equal(domain.minPrice(car, { km: 1000, business: false }), 1574 + 59);
  assert.deepEqual(domain.kmPackages(car, { business: true }).map(entry => entry.fee), [0, 50, 487]);
  assert.deepEqual(domain.kmPackages(car).map(entry => entry.fee), [0, 59, 579]);
  assert.equal(domain.kmFeeFor(car, 1500, { business: true }), 50, "falls back to the closest lower package");
});

test("only mileage packages FINN offers are accepted", () => {
  assert.equal(domain.isMileagePackage(3000), true);
  assert.equal(domain.isMileagePackage(3500), false);
  assert.equal(domain.decodeViewState("#km=3500").km, null);
  assert.equal(domain.decodeViewState("#km=4000").km, 4000);
  assert.equal(domain.decodeViewState("#" + domain.encodeViewState({ km: 5000 })).km, 5000);
});

test("shareable view state round-trips filters and controls", () => {
  const filters = domain.freshFilters();
  Object.assign(filters, {
    q: "IONIQ 5",
    fuels: ["Elektro"],
    brands: ["!Audi", "Hyundai"],
    terms: ["12", "24"],
    priceMax: 900,
    powerMin: 160,
    soon: true,
    deals: true
  });
  const encoded = domain.encodeViewState({ filters, km: 2500, browseMode: "models", sort: "price-asc" });
  const decoded = domain.decodeViewState("#" + encoded);
  assert.equal(decoded.hasState, true);
  assert.deepEqual(decoded.filters, filters);
  assert.equal(decoded.km, 2500);
  assert.equal(decoded.browseMode, "models");
  assert.equal(decoded.sort, "price-asc");
});

test("recently added sort is accepted in shared view state", () => {
  const encoded = domain.encodeViewState({ sort: "added-desc" });
  assert.equal(encoded, "sort=added-desc");
  assert.equal(domain.decodeViewState("#" + encoded).sort, "added-desc");
});

const at = (day, hour = 12) => new Date(2026, 10, day, hour).getTime();
const snapshot = (t, b2b12, extra1000 = 30) => ({
  t,
  price: { b2b_12: b2b12, b2b_24: b2b12 - 50, b2c_12: b2b12 + 80, extra_500: 0, extra_1000: extra1000 }
});

test("daily history holds each closing price and starts at first observation", () => {
  const history = { lastSeen: at(9), changes: [snapshot(at(5), 400), snapshot(at(7, 8), 380), snapshot(at(7, 20), 370)] };
  const series = domain.priceHistorySeries(history, { granularity: "day", count: 5, term: 12, km: 500, business: true, now: new Date(at(9)) });
  assert.deepEqual(series.buckets.map(bucket => bucket.price), [400, 400, 370, 370, 370]);
  assert.equal(series.current, 370);
  assert.equal(series.low, 370);
  assert.equal(series.high, 400);
  assert.equal(series.delta, -30);
  assert.deepEqual(series.changes.map(change => change.to), [370, 380]);
});

test("days before the first observation stay empty", () => {
  const history = { lastSeen: at(9), changes: [snapshot(at(8), 400)] };
  const series = domain.priceHistorySeries(history, { granularity: "day", count: 4, term: 12, km: 500, business: true, now: new Date(at(9)) });
  assert.deepEqual(series.buckets.map(bucket => bucket.price), [null, null, 400, 400]);
});

test("days after a car left the catalog stay empty", () => {
  const history = { lastSeen: at(7), changes: [snapshot(at(6), 400)] };
  const series = domain.priceHistorySeries(history, { granularity: "day", count: 4, term: 12, km: 500, business: true, now: new Date(at(9)) });
  assert.deepEqual(series.buckets.map(bucket => bucket.price), [400, 400, null, null]);
});

test("weekly history uses Monday buckets and the latest price of each week", () => {
  // 9 Nov 2026 is a Monday, so the current bucket starts today.
  const history = { lastSeen: at(11), changes: [snapshot(at(3), 400), snapshot(at(5), 390), snapshot(at(10), 360)] };
  const series = domain.priceHistorySeries(history, { granularity: "week", count: 2, term: 12, km: 500, business: true, now: new Date(at(11)) });
  assert.equal(new Date(series.buckets[0].start).getDate(), 2);
  assert.equal(new Date(series.buckets[1].start).getDate(), 9);
  assert.deepEqual(series.buckets.map(bucket => bucket.price), [390, 360]);
});

test("history follows selected term, mileage package and pricing mode", () => {
  const history = { lastSeen: at(9), changes: [snapshot(at(9), 400, 45)] };
  const price = options => domain.priceHistorySeries(history, { count: 1, now: new Date(at(9)), ...options }).current;
  assert.equal(price({ term: 12, km: 500, business: true }), 400);
  assert.equal(price({ term: 24, km: 500, business: true }), 350);
  assert.equal(price({ term: 12, km: 1000, business: true }), 438);
  assert.equal(price({ term: 12, km: 1000, business: false }), 525);
  assert.equal(price({ term: 12, km: 500, business: false }), 480);
});

test("changes on another term are not reported for the selected term", () => {
  const first = { t: at(5), price: { b2b_12: 400, b2b_24: 350 } };
  const second = { t: at(6), price: { b2b_12: 400, b2b_24: 330 } };
  const series = domain.priceHistorySeries({ lastSeen: at(9), changes: [first, second] }, { count: 7, term: 12, km: 500, business: true, now: new Date(at(9)) });
  assert.deepEqual(series.changes, []);
  assert.equal(series.delta, 0);
});

test("history without a price for the term has no current value", () => {
  const history = { lastSeen: at(9), changes: [{ t: at(9), price: { b2b_12: 400 } }] };
  assert.equal(domain.priceHistorySeries(history, { count: 1, term: 36, km: 500, business: true, now: new Date(at(9)) }).current, null);
  assert.equal(domain.priceHistorySeries(null, { count: 1, now: new Date(at(9)) }).current, null);
});

test("history can follow several selected terms like the card price", () => {
  const history = { lastSeen: at(9), changes: [{ t: at(9), price: { b2b_12: 400, b2b_24: 350, b2b_36: 300 } }] };
  const series = domain.priceHistorySeries(history, { count: 1, terms: [12, 24], km: 500, business: true, now: new Date(at(9)) });
  assert.equal(series.current, 350);
  assert.equal(domain.priceHistorySeries(history, { count: 1, terms: [], km: 500, business: true, now: new Date(at(9)) }).current, 300);
});

test("model trend follows the cheapest version per day", () => {
  const now = new Date(at(9));
  const options = { granularity: "day", count: 3, term: 12, km: 500, business: true, now };
  const cheap = domain.priceHistorySeries({ lastSeen: at(9), changes: [snapshot(at(8), 500)] }, options);
  const other = domain.priceHistorySeries({ lastSeen: at(9), changes: [snapshot(at(7), 450), snapshot(at(9), 520)] }, options);
  const merged = domain.lowestHistorySeries([cheap, other]);
  assert.deepEqual(merged.buckets.map(bucket => bucket.price), [450, 450, 500]);
  assert.equal(merged.current, 500);
  assert.equal(merged.delta, 50);
  assert.equal(domain.lowestHistorySeries([]), null);
});

test("history axis uses whole-euro ticks and gives flat prices a band", () => {
  assert.deepEqual(domain.historyAxis(617, 617), { min: 600, max: 630, ticks: [600, 610, 620, 630] });
  const axis = domain.historyAxis(350, 412);
  assert.ok(axis.min <= 350 && axis.max >= 412);
  assert.ok(axis.ticks.every(Number.isInteger));
});

test("price snapshots keep rates and mileage fees in a stable order", () => {
  const raw = { msrp: 1, extra_1000: 29, b2c_12: 734, b2b_12: 617, b2c_12_old: 800, extra_km_price: 0.36, available_price_list: { b2b_12: 617 } };
  assert.deepEqual(Object.entries(domain.normalizePriceSnapshot(raw)), [["b2b_12", 617], ["b2c_12", 734], ["extra_1000", 29]]);
  assert.equal(domain.normalizePriceSnapshot({ extra_500: 0 }), null);
  assert.equal(domain.normalizePriceSnapshot({ b2b_12: "617" }), null);
  assert.equal(domain.normalizePriceSnapshot(null), null);
});

test("price observations store only changes and advance lastSeen", () => {
  const first = domain.recordPriceObservation(undefined, { b2b_12: 400 }, 1000);
  assert.deepEqual(first, { firstSeen: 1000, lastSeen: 1000, changes: [{ t: 1000, price: { b2b_12: 400 } }] });
  const same = domain.recordPriceObservation(first, { b2b_12: 400, msrp: 9 }, 2000);
  assert.equal(same.lastSeen, 2000);
  assert.equal(same.changes.length, 1);
  const moved = domain.recordPriceObservation(same, { b2b_12: 380 }, 3000);
  assert.deepEqual(moved.changes.map(change => change.price.b2b_12), [400, 380]);
  assert.equal(first.lastSeen, 1000, "the input history is not mutated");
});

test("a live catalog older than the published history is ignored", () => {
  const history = domain.recordPriceObservation(undefined, { b2b_12: 400 }, 5000);
  assert.equal(domain.recordPriceObservation(history, { b2b_12: 300 }, 4000), history);
});

test("an observation without a usable price leaves the history alone", () => {
  const history = domain.recordPriceObservation(undefined, { b2b_12: 400 }, 1000);
  assert.equal(domain.recordPriceObservation(history, {}, 2000), history);
  assert.equal(domain.recordPriceObservation(undefined, {}, 2000), null);
});

test("view-state decoder rejects unsupported controls and invalid numbers", () => {
  const decoded = domain.decodeViewState("#km=1234&sort=hack&pmax=nope&pow=-10&fu=Elektro");
  assert.equal(decoded.km, null);
  assert.equal(decoded.sort, null);
  assert.equal(decoded.filters.priceMax, null);
  assert.equal(decoded.filters.powerMin, 0);
  assert.deepEqual(decoded.filters.fuels, ["Elektro"]);
});
