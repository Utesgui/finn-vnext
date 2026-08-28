"use strict";
/* ---------------- price-drop tracking (persists across visits) ---------------- */
const PRICE_LS = "finnvnext.prices.v1";
function minBaseMode(c, mode){ // cheapest base term price, mode "b" (business) / "c" (private)
  const p = c.price || {}, re = mode==="b" ? /^b2b_(\d+)$/ : /^b2c_(\d+)$/;
  let best = null;
  for(const k of Object.keys(p)) if (re.test(k)){
    const v = Number(p[k]);
    if (isFinite(v)&&v>0&&(best==null||v<best)) best = v;
  }
  return best;
}
function trackPrices(){
  let db = {}; try{ db = JSON.parse(localStorage.getItem(PRICE_LS)||"{}"); }catch(e){}
  const now = Date.now(), mode = state.cfg.biz ? "b" : "c";
  for(const c of state.cars){
    const rec = db[carKey(c)] || (db[carKey(c)] = {});
    for(const m of ["b","c"]){
      const cur = minBaseMode(c, m);
      if (cur==null) continue;
      const r = rec[m] || (rec[m] = {prev:null, cur:null, t:0});
      if (r.cur==null){ r.cur = cur; r.t = now; }
      else if (r.cur !== cur){ r.prev = r.cur; r.cur = cur; r.t = now; }
    }
    const r = rec[mode];
    c._drop = (r && r.prev!=null && r.cur < r.prev) ? r.prev - r.cur : 0;
  }
  try{ localStorage.setItem(PRICE_LS, JSON.stringify(db)); }catch(e){}
}

  /* ---------------- first-seen tracking (persists across visits) ----------------
     The API exposes no created/added timestamp, so we record when THIS tool first
     sees a config. The very first catalog load is treated as a baseline: those
     configs get no timestamp, so only configs appearing later count as "new". */
  const SEEN_LS = "finnvnext.firstseen.v1";
  const NEW_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  function trackFirstSeen(){
    let db = null; try{ db = JSON.parse(localStorage.getItem(SEEN_LS)||"null"); }catch(e){}
    const baseline = !db || typeof db !== "object";
    if (baseline) db = {};
    const now = Date.now();
    for(const c of state.cars){
      const key = carKey(c);
      if (db[key]==null) db[key] = baseline ? 0 : now;   // 0 = existed before tracking began
      c._firstSeen = db[key] || null;
      c._isNew = !!db[key] && (now - db[key]) < NEW_BADGE_WINDOW_MS;
    }
    // prune configs that left the catalog once the store gets large
    const keys = Object.keys(db);
    if (keys.length > 15000){
      const live = new Set(state.cars.map(carKey));
      for(const k of keys) if (!live.has(k)) delete db[k];
    }
    try{ localStorage.setItem(SEEN_LS, JSON.stringify(db)); }catch(e){}
  }

/* ---------------- sibling color stock DB (persisted, trickle-filled) ----------
   Each color of a version is its own config; the catalog payload only carries the
   listed config's stock. Every config we resolve (color clicks, detail chips, or
   the gentle background crawler below) lands here so "+" counts can become exact
   totals. ~2k uids ≈ a few dozen KB in localStorage. */
const SIBLING_LS = "finnvnext.siblingstock.v1";
const SIBLING_TTL_MS = 12 * 60 * 60 * 1000;
const SIBLING_CRAWL_DELAY_MS = 500;   // per-worker pause — still deliberately gentle
const SIBLING_CRAWL_WORKERS = 2;
let siblingDb = null;
function loadSiblingDb(){
  if (siblingDb) return siblingDb;
  try{ siblingDb = JSON.parse(localStorage.getItem(SIBLING_LS)||"{}") || {}; }catch(e){ siblingDb = {}; }
  return siblingDb;
}
function saveSiblingDb(){ try{ localStorage.setItem(SIBLING_LS, JSON.stringify(loadSiblingDb())); }catch(e){} }
function rememberSiblingStock(car, {defer=false}={}){
  if (!car) return;
  const uid = String(car.uid ?? car.config_id ?? "");
  if (!uid) return;
  loadSiblingDb()[uid] = { n: stockCount(car), t: Date.now(), tm: carTermsList(car) };
  if (!defer) saveSiblingDb();
}
function siblingStockRec(uid){ return loadSiblingDb()[String(uid)] || null; }
/* Terms a config can be subscribed for: available_terms plus price-key terms. */
function carTermsList(car){
  const terms = new Set((Array.isArray(car.available_terms)?car.available_terms:[]).map(Number).filter(Boolean));
  const p = car.price || {};
  for(const k of Object.keys(p)){ const m = /^b2[bc]_(\d+)$/.exec(k); if(m) terms.add(Number(m[1])); }
  return Array.from(terms).sort((a,b)=>a-b);
}
function absorbCatalogStock(){
  for (const c of state.cars) rememberSiblingStock(c, {defer:true});
  saveSiblingDb();
}
/* Effective stock of one version across all of its colors (own + known siblings). */
function versionStockInfo(c){
  const own = stockCount(c);
  const list = Array.isArray(c.color_list) ? c.color_list : [];
  if (list.length <= 1) return { total: own, known: true };
  const selfUid = String(c.uid ?? carKey(c));
  let total = 0, known = true, any = false;
  for (const cl of list){
    const uid = cl && cl.uid!=null ? String(cl.uid) : null;
    if (uid === selfUid){ if (own!=null){ total += own; any = true; } continue; }
    const rec = uid ? siblingStockRec(uid) : null;
    if (rec){ // resolved: n may be null when the API has no such config (yet) — counts as known zero
      if (rec.n!=null){ total += rec.n; any = true; }
    }
    else known = false;
  }
  if (!any && own!=null){ total = own; any = true; }
  return { total: any ? total : null, known };
}
let crawlGen = 0;
/* Hydrate the sibling-stock DB from the snapshot the GitHub Actions bot
   publishes alongside the app. Optional — local dev setups simply 404 here. */
async function hydrateStockSnapshot(){
  try{
    const res = await fetch("data/stock-snapshot.json", {cache:"no-store"});
    if(!res.ok) return;
    const snap = await res.json();
    if(!snap || typeof snap.stock !== "object" || !snap.stock) return;
    const db = loadSiblingDb();
    let merged = 0;
    for(const [uid, rec] of Object.entries(snap.stock)){
      if(!rec) continue;
      const t = Number(rec.t)||0;
      const cur = db[uid];
      if(!cur || t > cur.t){
        db[uid] = {n: rec.n==null?null:Number(rec.n), t};
        if (Array.isArray(rec.tm)) db[uid].tm = rec.tm.map(Number).filter(Boolean);
        merged++;
      }
    }
    if(merged){
      saveSiblingDb();
      if(state.cars.length){
        if(typeof updateStockDisplays === "function") updateStockDisplays();
        startSiblingCrawl();   // re-plan the sweep with the new data folded in
      }
    }
  }catch(e){ /* snapshot is an optional enhancement */ }
}
function startSiblingCrawl(){
  crawlGen++;
  if (state.cfg.stockCrawl === false) return;
  const gen = crawlGen, db = loadSiblingDb(), now = Date.now(), seen = new Set();
  const queue = [];
  for (const c of state.cars){
    const list = Array.isArray(c.color_list) ? c.color_list : [];
    if (list.length <= 1) continue;
    const selfUid = String(c.uid ?? carKey(c));
    for (const cl of list){
      const uid = cl && cl.uid!=null ? String(cl.uid) : null;
      if (!uid || uid===selfUid || seen.has(uid)) continue;
      seen.add(uid);
      const rec = db[uid];
      if (!rec || (now - rec.t) > SIBLING_TTL_MS) queue.push(uid);
    }
  }
  if (!queue.length) return;
  fetchConfigByUid.failures = 0;
  let fetched = 0;
  const worker = () => {
    if (gen !== crawlGen) return;
    if (document.hidden){ setTimeout(worker, 15000); return; }   // pause in background tabs
    const uid = queue.shift();
    if (uid == null){ if (typeof updateStockDisplays==="function") updateStockDisplays(); return; }
    fetchConfigByUid(uid).then(()=>{
      if (gen !== crawlGen) return;
      if (fetchConfigByUid.failures >= 6) return;   // repeated failures — likely offline, stop quietly
      fetched++;
      if (fetched % 10 === 0 && typeof updateStockDisplays==="function") updateStockDisplays();
      setTimeout(worker, SIBLING_CRAWL_DELAY_MS);
    });
  };
  for (let i = 0; i < SIBLING_CRAWL_WORKERS; i++) setTimeout(worker, 3000 + i*700);
}

/* ---------------- single-config lookup (color variants) ---------------- */
const configFetchCache = new Map();
async function fetchConfigByUid(uid){
  const key = `${uid}:${state.cfg.biz?"b":"c"}`;
  if (configFetchCache.has(key)) return configFetchCache.get(key);
  try{
    const json = await tryFetch(proxied(carsUrl(state.cfg.base, state.cfg.actor, {
      config_id: String(uid), is_for_business: state.cfg.biz, pricing_type: "normal", limit: 3
    })), state.cfg.actor, {timeoutMs: PROBE_TIMEOUT_MS});
    const results = Array.isArray(json && json.results) ? json.results : [];
    const car = results.find(x=>String(x.uid??x.config_id)===String(uid)) || results[0] || null;
    configFetchCache.set(key, car);
    fetchConfigByUid.failures = 0;
    if (car) rememberSiblingStock(car);
    else { // the API genuinely has no such config (yet) — remember the resolved miss
      loadSiblingDb()[String(uid)] = {n:null, t:Date.now()};
      saveSiblingDb();
    }
    return car;
  }catch(e){
    // network/server trouble: do NOT cache, so the variant is retried later
    fetchConfigByUid.failures = (fetchConfigByUid.failures||0) + 1;
    return null;
  }
}
fetchConfigByUid.failures = 0;

/* ---------------- API layer ---------------- */
const REQUEST_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 6000;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_CACHE_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;   // serve-stale ceiling
const CATALOG_CACHE_DB = "finnvnext-cache-v2";
const CATALOG_CACHE_STORE = "catalogs";

async function fetchWithTimeout(url, options={}, {timeoutMs=REQUEST_TIMEOUT_MS,signal}={}){
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = ()=>controller.abort(signal&&signal.reason);
  if(signal){
    if(signal.aborted) abortFromParent();
    else signal.addEventListener("abort",abortFromParent,{once:true});
  }
  const timer = setTimeout(()=>{ timedOut=true; controller.abort(); },timeoutMs);
  try{
    return await fetch(url,{...options,signal:controller.signal});
  }catch(error){
    if(controller.signal.aborted){
      const wrapped = new Error(timedOut?`Request timed out after ${Math.round(timeoutMs/1000)} seconds`:"Request cancelled");
      wrapped.name = timedOut ? "TimeoutError" : "AbortError";
      throw wrapped;
    }
    throw error;
  }finally{
    clearTimeout(timer);
    if(signal) signal.removeEventListener("abort",abortFromParent);
  }
}

function openCatalogCache(){
  if(typeof indexedDB==="undefined") return Promise.resolve(null);
  return new Promise(resolve=>{
    const request=indexedDB.open(CATALOG_CACHE_DB,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(CATALOG_CACHE_STORE)) db.createObjectStore(CATALOG_CACHE_STORE,{keyPath:"key"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>resolve(null);
    request.onblocked=()=>resolve(null);
  });
}

function catalogCacheKey(){
  return JSON.stringify({base:state.cfg.base,actor:state.cfg.actor,proxy:state.cfg.proxy||"",view:state.cfg.view,biz:state.cfg.biz});
}

async function readCatalogCache(key){
  const db=await openCatalogCache();
  if(!db) return null;
  return new Promise(resolve=>{
    const request=db.transaction(CATALOG_CACHE_STORE,"readonly").objectStore(CATALOG_CACHE_STORE).get(key);
    request.onsuccess=()=>{
      const record=request.result;
      const age=record?Date.now()-record.savedAt:Infinity;
      resolve(record&&Array.isArray(record.cars)&&age<CATALOG_CACHE_MAX_STALE_MS
        ? {cars:record.cars, stale:age>=CATALOG_CACHE_TTL_MS}
        : null);
    };
    request.onerror=()=>resolve(null);
  });
}

async function writeCatalogCache(key,cars){
  const db=await openCatalogCache();
  if(!db) return;
  await new Promise(resolve=>{
    const tx=db.transaction(CATALOG_CACHE_STORE,"readwrite");
    tx.objectStore(CATALOG_CACHE_STORE).put({key,savedAt:Date.now(),cars});
    tx.oncomplete=resolve;
    tx.onerror=resolve;
    tx.onabort=resolve;
  });
}

function carsUrl(base, actor, params){
  const u = new URL(base.replace(/\/+$/,"") + "/cars", typeof location!=="undefined" ? location.href : "https://www.finn.com");
  Object.entries(params).forEach(([k,v])=>{ if(v!==null&&v!==undefined&&v!=="") u.searchParams.set(k,v); });
  if (actor) u.searchParams.set("actor", actor);
  return u.toString();
}
/* Wrap a target URL with the configured CORS proxy.
   Template placeholders: {url} = raw target, {bare} = target without the https://
   prefix (avoids double-slash mangling in some proxies), {enc} = URL-encoded target.
   A template without a placeholder is treated as a path prefix (cors-anywhere style).
   Empty template = direct call. */
function proxied(target, tpl){
  const t = (tpl!==undefined ? tpl : state.cfg.proxy || "").trim();
  if (!t) return target;
  if (t.includes("{enc}"))  return t.replace("{enc}", encodeURIComponent(target));
  if (t.includes("{bare}")) return t.replace("{bare}", target.replace(/^https?:\/\//,""));
  if (t.includes("{url}"))  return t.replace("{url}", target);
  return t.replace(/\/+$/,"") + "/" + target;
}
/* Accept several plausible wrappers around the car list, so a proxy or API
   variant that nests the payload differently doesn't fail the probe. */
function extractResults(json){
  if (!json || typeof json!=="object") return null;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.cars)) return json.cars;
  if (json.data && typeof json.data==="object"){
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.data.results)) return json.data.results;
  }
  return null;
}
async function tryFetch(url, actor, options={}){
  const headers = {accept:"application/json"};
  if (actor) headers["x-finn-actor"] = actor;   // required by the FINN API
  const res = await fetchWithTimeout(url,{headers},options);
  if(!res.ok){
    let hint = "";
    try{ const j = await res.json(); if (j && (j.error||j.message)) hint = " — " + (j.error||j.message); }catch(e){}
    const error=new Error("HTTP "+res.status+hint);
    error.status=res.status;
    throw error;
  }
  const json = await res.json();
  const results = extractResults(json);
  if(!results) throw new Error("Unexpected response shape from "+url.split("?")[0]);
  return {results, total: (typeof json.total_results==="number" ? json.total_results : null)};
}
async function probeEndpoint(signal){
  // saved config first, then the candidate matrix. Probes always use
  // view=available_cars — the safest value (other views 500 on some routes).
  const combos = [[state.cfg.base, state.cfg.actor, state.cfg.proxy||""]];
  for(const [b,a,p] of CANDIDATE_COMBOS)
    if(!(b===state.cfg.base && a===state.cfg.actor && p===(state.cfg.proxy||""))) combos.push([b,a,p]);
  const attempts = [];
  for(const [base,actor,proxy] of combos){
    const url = proxied(carsUrl(base, actor, {limit:1, view:"available_cars"}), proxy);
    try{
      await tryFetch(url,actor,{signal,timeoutMs:PROBE_TIMEOUT_MS});
      state.cfg.base = base; state.cfg.actor = actor; state.cfg.proxy = proxy; saveCfg();
      state.lastProbe = attempts;
      return true;
    }catch(e){
      if(signal&&signal.aborted) throw e;
      attempts.push({url,msg:String((e&&e.message)||e)});
    }
  }
  state.lastProbe = attempts;
  throw new Error("All "+attempts.length+" connection attempts failed");
}

function commitCatalog(cars,{cached=false}={}){
  state.cars=cars;
  trackPrices();
  trackFirstSeen();
  absorbCatalogStock();
  startSiblingCrawl();
  state.facets=buildFacets(state.cars);
  buildFilterUI();
  // Default to electric on an unfiltered first visit; shared URLs remain exact.
  if(!state.evDefaulted){
    state.evDefaulted=true;
    const ev=state.facets.fuels.find(([value])=>/elek|electr/i.test(value));
    if(ev&&!state.f.fuels.length) state.f.fuels.push(ev[0]);
  }
  syncChipStates();
  restoreControls();
  const catalogStock=aggregateStock(state.cars);
  setStatus("ok",`${fmtNum(state.cars.length)} configurations${catalogStock==null?"":` · ${stockText(catalogStock)}`} · ${state.cfg.biz?"business":"private"} prices${cached?" · cached":state.cfg.proxy?" · via proxy":""}`);
  apply();
}

async function loadCatalog(options={}){
  // this view 500s on the finn.com /api route — migrate old saved configs away from it
  if (state.cfg.view === "available-and-coming-soon"){ state.cfg.view = "available_cars"; saveCfg(); }
  const force=options&&options.force===true;
  const gen = ++state.loadGen;   // invalidates any load still in flight
  if(state.loadController) state.loadController.abort();
  const controller=new AbortController();
  state.loadController=controller;
  const {signal}=controller;
  state.loading = true;
  setStatus("busy", "Loading catalog…");
  hideBanner();
  // Cache-first: any cached catalog (up to 7 days old) renders immediately;
  // anything older than the fresh TTL is then refreshed silently in the
  // background and swapped in when ready.
  let servedStale = false;
  try{
    if(!force){
      const cached=await readCatalogCache(catalogCacheKey());
      if(gen!==state.loadGen||signal.aborted) return;
      if(cached){
        commitCatalog(cached.cars,{cached:true});
        if(!cached.stale) return;
        servedStale = true;
        setStatus("busy", `${fmtNum(cached.cars.length)} configurations · cached — refreshing…`);
      }
    }
    if(!servedStale) renderSkeletons();
    await probeEndpoint(signal);
    async function fetchView(view, seen, markSoon){
      let offset = 0, limit = Number(state.cfg.limit)||200, pages = 0;
      for(;;){
        if (gen !== state.loadGen||signal.aborted) return;
        let json;
        try{
          json = await tryFetch(proxied(carsUrl(state.cfg.base, state.cfg.actor, {
            view, is_for_business: state.cfg.biz, pricing_type:"normal",
            limit, offset, sort:"last_added"
          })),state.cfg.actor,{signal});
        }catch(e){
          if(signal.aborted) throw e;
          if(limit>24&&[400,413,500,502,503,504].includes(e.status)){ limit=Math.max(24,Math.floor(limit/2)); continue; }
          throw e;
        }
        for(const c of json.results){
          if (markSoon) c._soonView = true;
          if (!seen.has(carKey(c))){
            // FINN returns `last_added` newest first. Keep that rank so local
            // filters and grouped browsing can still offer the same ordering.
            c._addedOrder = seen.size;
            seen.set(carKey(c), c);
          }
        }
        pages++;
        setStatus("busy", `Loading… ${seen.size} configurations`);
        if (json.results.length < limit || (json.total && pages*limit >= json.total) || pages >= 40 || seen.size >= 6000) break;
        offset += limit;
      }
    }
    const seen = new Map();
    await fetchView(state.cfg.view, seen, state.cfg.view==="coming-soon");
    // the API's combined view 500s, so merge FINN's coming-soon list in ourselves
    if (state.cfg.view === "available_cars"){
      try{ await fetchView("coming-soon",seen,true); }catch(e){ if(signal.aborted) throw e; /* supplemental */ }
    }
    if(gen!==state.loadGen||signal.aborted) return;
    const cars=Array.from(seen.values());
    void writeCatalogCache(catalogCacheKey(),cars);
    commitCatalog(cars);
  }catch(err){
    if (gen !== state.loadGen) return;
    if (servedStale){
      // the cached catalog stays usable — report the failed refresh quietly
      setStatus("ok", `${fmtNum(state.cars.length)} configurations · cached (refresh failed: ${String((err&&err.message)||err)})`);
    } else {
      state.cars = []; state.filtered = [];
      $("#grid").innerHTML = "";
      setStatus("err", "API unreachable");
      showBanner(err);
    }
  }finally{
    if (gen === state.loadGen){
      state.loading = false;
      if(state.loadController===controller) state.loadController=null;
      scheduleAutoFill();
    }
  }
}
function setStatus(kind, txt){
  const el = $("#status");
  el.className = "pill " + kind;
  el.title = txt;
  $("#statusTxt").textContent = txt;
}
function showBanner(err){
  const el = $("#banner");
  const attempts = state.lastProbe || [];
  const rows = attempts.map(a =>
    `<div style="margin-block-start:.35rem"><code style="word-break:break-all">${esc(a.url)}</code><br>→ <span style="color:var(--cp-danger)">${esc(a.msg)}</span></div>`).join("");
  el.innerHTML =
    `<b>Couldn't reach the FINN API.</b> ${esc(err.message)}.
     <br>Reading the log: <i>Failed to fetch</i> = network/CORS · <i>HTTP 401</i> = actor rejected · <i>HTTP 404</i> = wrong path · <i>HTTP 500</i> = server error / bad parameter.
     Adjust base URL, actor or proxy in ⚙ Settings.
     ${rows?`<details style="margin-block-start:.55rem"><summary style="cursor:pointer">Show all ${attempts.length} attempts</summary>${rows}</details>`:""}
     <div class="actions"><button id="retryBtn"><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg> Retry</button><button id="openSettings2">Settings</button></div>`;
  el.classList.add("show");
  $("#retryBtn").addEventListener("click",()=>loadCatalog({force:true}));
  $("#openSettings2").addEventListener("click", openSettings);
}
function hideBanner(){ $("#banner").classList.remove("show"); }

/* ---------------- facets ---------------- */
function buildFacets(cars){
  const cnt = (map,k)=>{ if(k==null||k==="")return; const s=String(k).trim(); if(!s)return; map.set(s,(map.get(s)||0)+1); };
  const brands=new Map(), fuels=new Map(), types=new Map(), gears=new Map(),
        seats=new Map(), doors=new Map(), colors=new Map();
  const termSet=new Set();
  let pMin=Infinity, pMax=0, powMax=0, rngMax=0;
  for(const c of cars){
    cnt(brands, brandName(c)); cnt(fuels, c.fuel); cnt(types, c.cartype); cnt(gears, c.gearshift);
    cnt(seats, c.seats); cnt(doors, c.doors);
    if (c.color && c.color.specific) colors.set(c.color.specific, c.color.color_hex||"");
    (Array.isArray(c.available_terms)?c.available_terms:[]).forEach(t=>termSet.add(Number(t)));
    priceList(c).forEach(x=>termSet.add(x.term));
    // color siblings are separate configs and may offer additional terms
    for(const cl of (Array.isArray(c.color_list)?c.color_list:[])){
      const rec = cl && cl.uid!=null ? siblingStockRec(cl.uid) : null;
      if (rec && Array.isArray(rec.tm)) rec.tm.forEach(t=>termSet.add(Number(t)));
    }
    const p = minPrice(c);
    if(p!=null){ pMin=Math.min(pMin,p); pMax=Math.max(pMax,p); }
    powMax=Math.max(powMax, Number(c.power)||0);
    rngMax=Math.max(rngMax, evRange(c)||0);
  }
  const sortMap = m => Array.from(m.entries()).sort((a,b)=>b[1]-a[1]);
  return {
    brands: Array.from(brands.entries()).sort((a,b)=>a[0].localeCompare(b[0])),
    fuels: sortMap(fuels), types: sortMap(types), gears: sortMap(gears),
    seats: Array.from(seats.keys()).sort((a,b)=>a-b), doors: Array.from(doors.keys()).sort((a,b)=>a-b),
    colors: Array.from(colors.entries()).sort((a,b)=>a[0].localeCompare(b[0])),
    terms: Array.from(termSet).filter(t=>!isNaN(t)&&t>0).sort((a,b)=>a-b),
    priceMin: pMin===Infinity?0:Math.floor(pMin/10)*10,
    priceMax: Math.ceil(pMax/10)*10 || 2000,
    powerMax: Math.ceil(powMax/10)*10 || 400,
    rangeMax: Math.ceil(rngMax/10)*10 || 700
  };
}

