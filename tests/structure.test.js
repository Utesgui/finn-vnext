"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("document loads external active assets in dependency order", () => {
  const html = read("index.html");
  const domain = html.indexOf('src="js/domain.js');
  const core = html.indexOf('src="js/core.js');
  const api = html.indexOf('src="js/api.js');
  const ui = html.indexOf('src="js/ui.js');
  const events = html.indexOf('src="js/events.js');
  assert.ok(domain >= 0 && domain < core && core < api && api < ui && ui < events);
  assert.doesNotMatch(html, /src="js\/app\.js/);
  assert.equal(fs.existsSync(path.join(root, "js", "app.js")), false);
  assert.match(html, /href="styles\/app\.css/);
  assert.doesNotMatch(html, /legacyStyles|modernStyles|FINN vNext — internal vehicle search/);
});

test("audited terminology and semantic card controls remain in source", () => {
  const html = read("index.html");
  const ui = read("js/ui.js");
  assert.match(html, />\s*Configurations\s*<\/button>/);
  assert.doesNotMatch(html, />\s*All cars\s*<\/button>/);
  assert.match(ui, /<button class="card-open" data-open-group aria-label=/);
  assert.match(ui, /aria-label="Toggle favorite"/);
  assert.match(ui, /aria-label="Add to compare"/);
  assert.doesNotMatch(ui, /setAttribute\("role","button"\)/);
  assert.doesNotMatch(ui, /<span class="badge soon">soon<\/span>/);
});

test("equipment categories are all visible without a tab menu", () => {
  const ui = read("js/ui.js");
  const css = read("styles/app.css");
  assert.match(ui, /<section class="equipment-panel" aria-labelledby="eqHeading/);
  assert.match(ui, /grouped by category/);
  assert.doesNotMatch(ui, /equipment-tabs|data-eq-tab|data-eq-panel|role="tablist"/);
  assert.doesNotMatch(css, /\.equipment-tabs|\.equipment-tab\b|\.equipment-panels/);
});

test("API reliability and cache guards remain enabled", () => {
  const api = read("js/api.js");
  assert.match(api, /new AbortController\(\)/);
  assert.match(api, /REQUEST_TIMEOUT_MS = 30000/);
  assert.match(api, /PROBE_TIMEOUT_MS = 6000/);
  assert.match(api, /CATALOG_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(api, /indexedDB\.open/);
});

test("documentation warns that noindex is not authentication", () => {
  const readme = read("README.md");
  assert.match(readme, /not authentication/i);
  assert.match(readme, /identity-aware gateway|VPN/i);
  assert.match(readme, /npm test/);
});
