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
    { term: 12, price: 430 },
    { term: 24, price: 380 }
  ]);
  assert.equal(domain.minPrice(car, { km: 1000, business: false }), 450);
  assert.equal(domain.minPrice(car, { km: 500, business: true, terms: [12] }), 400);
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

test("view-state decoder rejects unsupported controls and invalid numbers", () => {
  const decoded = domain.decodeViewState("#km=1234&sort=hack&pmax=nope&pow=-10&fu=Elektro");
  assert.equal(decoded.km, null);
  assert.equal(decoded.sort, null);
  assert.equal(decoded.filters.priceMax, null);
  assert.equal(decoded.filters.powerMin, 0);
  assert.deepEqual(decoded.filters.fuels, ["Elektro"]);
});
