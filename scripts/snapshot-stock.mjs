#!/usr/bin/env node
/* Stock snapshot bot — fetches the FINN catalog plus every color-sibling config
   and writes data/stock-snapshot.json for the client to hydrate its local
   sibling-stock DB from. Deliberately gentle: one sibling request every ~2 s,
   backoff on server errors, hard runtime cap. Node 20+, no dependencies. */
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = process.env.FINN_BASE || "https://www.finn.com/api";
const ACTOR = process.env.FINN_ACTOR || "finn-vnext";
const OUT = new URL("../data/stock-snapshot.json", import.meta.url);
const PAGE_LIMIT = 200;
const SIBLING_DELAY_MS = Number(process.env.SNAPSHOT_DELAY_MS || 2000);
const MAX_RUNTIME_MS = Number(process.env.SNAPSHOT_MAX_MS || 70 * 60 * 1000);
const MAX_CONSECUTIVE_FAILURES = 8;

const startedAt = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const u = new URL(BASE.replace(/\/+$/, "") + "/cars");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u, {
    headers: { accept: "application/json", "x-finn-actor": ACTOR },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

function stockOf(car) {
  const webflow = Number(car.product_stock_webflow);
  if (Number.isFinite(webflow) && webflow >= 0) return webflow;
  const total = Number(car.product_stock_total);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

async function main() {
  let previous = { stock: {} };
  try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }
  const stock = { ...(previous.stock || {}) };
  const now = Date.now();

  // 1) Page through the catalog — listed configs carry their stock for free.
  const listed = new Map();
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const json = await api({ view: "available_cars", is_for_business: true, pricing_type: "normal", limit: PAGE_LIMIT, offset, sort: "last_added" });
    const results = Array.isArray(json.results) ? json.results : [];
    for (const car of results) {
      const uid = String(car.uid ?? car.config_id ?? "");
      if (uid && !listed.has(uid)) listed.set(uid, car);
    }
    if (results.length < PAGE_LIMIT || offset > 8000) break;
    await sleep(400);
  }
  for (const [uid, car] of listed) stock[uid] = { n: stockOf(car), t: now };
  console.log(`catalog: ${listed.size} listed configs`);

  // 2) Collect sibling color uids that are not listed themselves.
  const siblings = new Set();
  for (const car of listed.values())
    for (const cl of car.color_list || []) {
      const uid = cl && cl.uid != null ? String(cl.uid) : null;
      if (uid && !listed.has(uid)) siblings.add(uid);
    }
  console.log(`siblings to resolve: ${siblings.size}`);

  // 3) Trickle-fetch each sibling config until done or out of budget.
  let fetched = 0, failures = 0;
  for (const uid of siblings) {
    if (Date.now() - startedAt > MAX_RUNTIME_MS) { console.log("runtime budget reached — stopping early"); break; }
    try {
      const json = await api({ config_id: uid, is_for_business: true, pricing_type: "normal", limit: 3 });
      const results = Array.isArray(json.results) ? json.results : [];
      const car = results.find(x => String(x.uid ?? x.config_id) === uid) || results[0] || null;
      stock[uid] = { n: car ? stockOf(car) : null, t: Date.now() };
      failures = 0;
      if (++fetched % 50 === 0) console.log(`…${fetched}/${siblings.size} siblings`);
    } catch (e) {
      failures++;
      console.warn(`uid ${uid}: ${e.message}`);
      if (failures >= MAX_CONSECUTIVE_FAILURES) { console.error("too many consecutive failures — aborting sweep"); break; }
      await sleep(10000);
    }
    await sleep(SIBLING_DELAY_MS);
  }

  // 4) Drop entries that vanished from the color graph entirely (keeps the file small).
  const known = new Set([...listed.keys(), ...siblings]);
  for (const uid of Object.keys(stock)) if (!known.has(uid)) delete stock[uid];

  const snapshot = {
    generatedAt: new Date().toISOString(),
    listed: listed.size,
    entries: Object.keys(stock).length,
    stock,
  };
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot));
  console.log(`wrote ${snapshot.entries} entries (${fetched} sibling fetches this run)`);
}

main().catch(e => { console.error(e); process.exit(1); });
