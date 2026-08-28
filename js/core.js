"use strict";
/* =============================================================
   FINN vNext — internal vehicle search
   Data source: FINN Product API  (GET /cars)
   Docs: https://docs.product-api.finn.com/
   Strategy: page through the full catalog once, then filter /
   sort / search entirely client-side => filtering always works.
   ============================================================= */

const LS_KEY = "finnvnext.v3"; // v3: actor moved to the x-finn-actor request header
const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="none"/><g fill="none" stroke="currentColor" stroke-width="2"><path d="M54 55h-6V43l7-14h50l7 14v12h-6"/><circle cx="62" cy="55" r="6"/><circle cx="98" cy="55" r="6"/><path d="M68 55h24M55 43h57"/></g><text x="80" y="75" font-family="sans-serif" font-size="8" fill="currentColor" text-anchor="middle">image unavailable</text></svg>');

/* The finn.com frontend fetches vehicle data from same-origin Next.js routes:
   https://www.finn.com/api/cars and /api/filters/cars — no actor parameter.
   (Verified via DevTools on the live site, 2026-07.) The Product-API hosts are
   kept as fallbacks, and a relative /api base is tried first when this app is
   served via the bundled proxy.py (which forwards /api/* to www.finn.com). */
const DEFAULTS = {
  base: "https://www.finn.com/api",
  actor: "finn-vnext",                     // sent as x-finn-actor header (required by the API)
  proxy: "https://anycors.b0t.at/?{url}",  // company CORS proxy: whole query string = target URL
  view: "available_cars",
  limit: 200,
  biz: true,
  km: 500,                                 // monthly mileage package (500 is included in base price)
  density: "grid",
  browseMode: "cars",
  theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light"
};
/* Connection facts (verified via browser console, 2026-07-25):
   - product-api.finn.com is LIVE and CORS-open, but rejects unknown actors with 401
     -> we scan a list of plausible actor values (each check is one tiny request).
   - www.finn.com/api hosts same-origin routes (filters/cars confirmed); /cars there
     returned 404 via the proxy and 500 directly -> tried in several spellings, late.
   - anycors.b0t.at works path-prefix style; the ?url= form returns 500.
   Probe order: saved config, own-origin /api (proxy.py), then the matrix below. */
/* anycors.b0t.at (b0t-at/cors-proxy, Flask): only the ROOT route proxies, and the
   ENTIRE query string is the target URL -> https://anycors.b0t.at/?<target-url>.
   It forwards all request headers, so x-finn-actor passes through.
   AUTH (confirmed live 2026-07-25): www.finn.com/api/cars answers
   {"error":"x-finn-actor header is required"} -> the actor is an HTTP HEADER. */
const ANYCORS = "https://anycors.b0t.at/?{url}";
const ACTOR_TRIES = ["finn-vnext","finn-web","nextjs","web"];
const CANDIDATE_COMBOS = (typeof location!=="undefined" && /^https?:$/.test(location.protocol) && !/finn\.com$/.test(location.hostname)
    ? [[location.origin + "/api", "finn-vnext", ""]] : []).concat(
  // 1) finn.com API through anycors, x-finn-actor header candidates
  ACTOR_TRIES.map(a=>["https://www.finn.com/api", a, ANYCORS]),
  // 2) documented Product API direct (CORS-open), same header candidates
  ACTOR_TRIES.map(a=>["https://product-api.finn.com", a, ""]),
  // 3) finn.com /api direct — works only from a finn.com-allowed origin
  [["https://www.finn.com/api", "finn-vnext", ""]]);

/* Pure domain helpers live in js/domain.js and are covered by Node tests. */
const {freshFilters,isNeg,facetPass,cycleFacet,stockCount,aggregateStock} = FinnDomain;
const FAV_LS = "finnvnext.favs.v1";

const state = {
  cfg: loadCfg(),
  cars: [],
  filtered: [],
  displayItems: [],
  modelGroups: [],
  facets: null,
  renderCount: 0,
  compare: [],           // array of car keys, max 3
  favs: loadFavs(),      // Set of favorite car keys (persisted)
  detailIdx: -1,
  detailKey: null,
  detailList: null,
  detailGroupKey: null,
  detailQuoteKm: null,
  detailQuoteTerm: null,
  activeGroupKey: null,
  loadGen: 0,            // increments per load; stale in-flight loads bail out
  loadController: null,  // actively aborts superseded network work
  f: freshFilters(),
  sort: "reco",
  loading: false
};

function loadCfg(){
  let cfg;
  try{ cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY)||"{}")); }
  catch(e){ cfg = Object.assign({}, DEFAULTS); }
  const requested = new URLSearchParams(location.search).get("scoutTheme");
  if (requested === "light" || requested === "dark") cfg.theme = requested;
  return cfg;
}
function saveCfg(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(state.cfg)); }catch(e){} }
function loadFavs(){ try{ return new Set(JSON.parse(localStorage.getItem(FAV_LS)||"[]")); }catch(e){ return new Set(); } }
function saveFavs(){ try{ localStorage.setItem(FAV_LS, JSON.stringify(Array.from(state.favs))); }catch(e){} }
function applyTheme(){
  const t = state.cfg.theme==="light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  const meta = document.getElementById("themeColorMeta");
  if (meta) meta.content = t==="dark" ? "#0d0f12" : "#f5f4f1";
  const button = document.querySelector("#themeBtn");
  const use = button && button.querySelector("use");
  if (use) use.setAttribute("href", t==="dark" ? "#i-sun" : "#i-moon");
  if (button){
    const next = t==="dark" ? "light" : "dark";
    button.title = `Use ${next} theme`;
    button.setAttribute("aria-label", `Use ${next} theme`);
  }
}
function toggleTheme(){
  state.cfg.theme = state.cfg.theme==="light" ? "dark" : "light";
  saveCfg();
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches){
    document.startViewTransition(applyTheme);
  } else {
    applyTheme();
  }
}

/* ---------------- helpers ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmtEur  = n => n==null ? "–" : new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const fmtEur2 = n => n==null ? "–" : new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",minimumFractionDigits:2}).format(n);
const fmtNum  = n => n==null ? "–" : new Intl.NumberFormat("en-GB").format(n);
const fmtDateTime = t => t ? new Date(t).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "–";
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const debounce = (fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
const vehicleColorStyle = value => {
  const color = String(value||"").trim();
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(color) ? ` style="--vehicle-color:${color}"` : "";
};
const VALUE_LABELS = {
  fuel: {Benzin:"Petrol",Diesel:"Diesel",Elektro:"Electric","Plug-In-Hybrid":"Plug-in hybrid"},
  body: {Cabriolet:"Convertible",Coupé:"Coupé",Estate:"Estate",Hatchback:"Hatchback","Klein- und Kompaktwagen":"Compact",Kombi:"Estate",Limousine:"Saloon",SUV:"SUV",Sedan:"Sedan",Van:"Van"},
  gear: {Automatik:"Automatic",Manuell:"Manual"},
  drive: {AWD:"AWD",Allrad:"All-wheel drive",FWD:"FWD",Frontantrieb:"Front-wheel drive",Heckantrieb:"Rear-wheel drive",RWD:"RWD"}
};
const PRODUCT_LABELS = {
  "50% KM-Rabatt":"50% mileage discount",
  "Aufbereitet":"Refurbished",
  "Frühbucherangebot":"Early-booking offer",
  "Reduziert":"Reduced",
  "Schnell verfügbar":"Available soon",
  "Spare mit PayPal":"Save with PayPal",
  "Vorteilspreis auf KM-Pakete":"Mileage package offer"
};
const displayValue = (kind,value) => value==null ? "" : (VALUE_LABELS[kind]&&VALUE_LABELS[kind][value]) || String(value);
const displayValues = (kind,values) => Array.from(new Set(values.map(value=>displayValue(kind,value)).filter(Boolean)));
const facetTag = (kind,value) => isNeg(value) ? "not "+displayValue(kind,value.slice(1)) : displayValue(kind,value);
const displayProductLabel = value => {
  const normalized=String(value||"").trim();
  return PRODUCT_LABELS[normalized]||normalized;
};
const fmtDate = value => {
  const date=FinnDomain.parseAvailableDate(value);
  return date ? date.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "";
};

function carKey(c){ return String(c.config_id ?? c.id ?? c.uid); }
function carName(c){ return `${brandName(c)} ${c.model||""}`.trim(); }
function brandName(c){ return (c.brand && (c.brand.id||c.brand.name)) || c.brand_id || "?"; }
function modelGroupKey(c){ return encodeURIComponent(brandName(c)) + "~" + encodeURIComponent(c.model||"Other model"); }
function isEV(c){ return /elek|electr|ev/i.test(c.fuel||""); }
function evRange(c){ const v = parseInt(c.ev_range,10); return isNaN(v)?null:v; }
function pictureUrl(c){
  if (c.picture && c.picture.url) return c.picture.url;
  if (Array.isArray(c.pictures) && c.pictures[0] && c.pictures[0].url) return c.pictures[0].url;
  return null;
}
function stockText(count){ return count == null ? null : `${fmtNum(count)} ${count===1?"car":"cars"}`; }
/* Real /cars price schema (verified against a live response, 2026-07-25):
   price: { msrp, b2b_12: 407, b2c_12: 484, extra_500: 0, extra_1000: 29, ... }
   -> monthly prices are per-term keys b2b_<term> / b2c_<term>;
   the documented available_price_list map is kept as a fallback. */
function priceList(c, km=state.cfg.km){
  return FinnDomain.priceList(c,{km,business:state.cfg.biz});
}
/* monthly surcharge for the selected km package (extra_500/extra_1000/…);
   falls back to the closest available package when the exact one is missing */
function kmFeeFor(c, km){
  return FinnDomain.kmFeeFor(c,km);
}
/* Optional extra-kilometer packages: price.extra_500 / extra_1000 / ... = fee/month */
function kmPackages(c){
  return FinnDomain.kmPackages(c);
}
function minPrice(c, terms, km=state.cfg.km){
  return FinnDomain.minPrice(c,{terms,km,business:state.cfg.biz});
}
function hasDeal(c){
  const dp = c.downpayment_prices||{};
  return !!(c.product_label && c.product_label.label) ||
         Number(dp.downpayment_discount_percentage)>0 || Number(dp.downpayment_fixed_amount)>0;
}
function hasHitch(c){
  const cf = c.closed_features_list;
  if (cf && typeof cf==="object" && "Anhängerkupplung" in cf) return cf["Anhängerkupplung"]===true;
  const h=c.has_hitch;
  return h===true || (typeof h==="string" && h && !/^(nein|no|false|0)$/i.test(h));
}
function availDate(c){
  return FinnDomain.parseAvailableDate(c.available_from);
}
function availLabel(c){
  const info = FinnDomain.availabilityInfo(c.available_from);
  if(!info.date) return {txt:"on request",soon:false,date:null,days:null};
  if(info.availableNow) return {txt:"available now",soon:true,date:info.date,days:info.days};
  return {txt:"from "+fmtDate(info.date),soon:info.soon,date:info.date,days:info.days};
}
function finnLink(c){
  const p = c.product_link || c.product_path;
  if(!p) return null;
  if(/^https?:/i.test(p)) return p;
  return "https://www.finn.com" + (p.startsWith("/")?p:"/"+p);
}
function configPdfLink(c){
  const url = c.config && c.config.link;
  return typeof url==="string" && /^https?:\/\/.*\.pdf(?:$|[?#])/i.test(url) ? url : null;
}
function configPdfFilename(c){
  const stem = [brandName(c),c.model,c.trim_name||c.engine,c.config_id].filter(Boolean).join("-");
  let safe = "", separator = false;
  for(const char of stem){
    if(/[a-z0-9äöüß._-]/i.test(char)){ safe+=char; separator=false; }
    else if(!separator){ safe+="-"; separator=true; }
  }
  while(safe.startsWith("-")) safe=safe.slice(1);
  while(safe.endsWith("-")) safe=safe.slice(0,-1);
  return (safe || "vehicle-configuration") + ".pdf";
}
const EQUIPMENT_LABELS = {
  hasRearCamera:"Rear-view camera",hasPremiumSound:"Premium sound system",has360Camera:"360° camera",
  hasUsbRear:"Rear USB ports",hasUsbFront:"Front USB ports",hasAdaptiveCruiseControl:"Adaptive cruise control",
  hasKeylessEntry:"Keyless entry",hasKeylessStart:"Keyless start",hasHitch:"Towbar",hasEcall:"eCall emergency system",
  hasPrivacyGlass:"Privacy glass",hasPanoramicRoof:"Panoramic roof",hasBlindSpotAssist:"Blind-spot assist",
  hasAlloyWheels:"Alloy wheels",hasLeatherSeats:"Leather seats",hasSeatHeating:"Heated seats",
  hasAuxiliaryHeating:"Auxiliary heating",hasHeadupDisplay:"Head-up display",hasHeatedSteeringWheel:"Heated steering wheel",
  hasWirelessCharging:"Wireless phone charging",hasSplitRearSeats:"Split-folding rear seats",hasParkingAssist:"Parking assist",
  hasElectricFrontSeats:"Electric front seats",hasCarplayAndroidauto:"Apple CarPlay & Android Auto",
  hasWirelessCarplayAndroidauto:"Wireless Apple CarPlay & Android Auto",hasMatrixLedHeadlights:"Matrix LED headlights",
  hasLedHeadlights:"LED headlights",hasRearCrossTrafficWarning:"Rear cross-traffic warning",hasSeatCooling:"Ventilated seats",
  hasHeatPump:"Heat pump",hasLumbarSupport:"Lumbar support",hasRainLightSensor:"Rain and light sensor",
  hasNavigation:"Navigation system",hasCorneringLights:"Cornering lights",hasElectricTailgate:"Electric tailgate",
  hasFogLights:"Fog lights",hasRoofRails:"Roof rails",hasFoldingMirrors:"Folding mirrors",hasAmbientLighting:"Ambient lighting",
  hasTrafficSignRecognition:"Traffic-sign recognition",hasCruiseControl:"Cruise control",hasStartStop:"Start/stop system",
  hasEmergencyBraking:"Emergency braking assist",hasElectricParkingBrake:"Electric parking brake",
  hasParkingSensors:"Parking sensors",hasTpms:"Tire-pressure monitoring",hasThreeZoneClimate:"Three-zone climate control"
};
const EQUIPMENT_CATEGORY_DEFS = [
  {title:"Comfort",prop:"comfort",icon:"i-users",description:"Climate, convenience and everyday comfort"},
  {title:"Exterior",prop:"exterior",icon:"i-car",description:"Wheels, lights and exterior features"},
  {title:"Interior",prop:"interior",icon:"i-users",description:"Cabin, seating and interior finishes"},
  {title:"Multimedia",prop:"multimedia",icon:"i-monitor",description:"Connectivity, audio and navigation"},
  {title:"Safety",prop:"safety",icon:"i-shield",description:"Driver assistance and protection"}
];
const EQUIPMENT_CATEGORY_BY_KEY = {
  hasPremiumSound:"Multimedia",hasUsbRear:"Multimedia",hasUsbFront:"Multimedia",hasCarplayAndroidauto:"Multimedia",
  hasWirelessCarplayAndroidauto:"Multimedia",hasWirelessCharging:"Multimedia",hasNavigation:"Multimedia",
  hasHitch:"Exterior",hasPrivacyGlass:"Exterior",hasPanoramicRoof:"Exterior",hasAlloyWheels:"Exterior",
  hasMatrixLedHeadlights:"Exterior",hasLedHeadlights:"Exterior",hasCorneringLights:"Exterior",hasElectricTailgate:"Exterior",
  hasFogLights:"Exterior",hasRoofRails:"Exterior",hasFoldingMirrors:"Exterior",
  hasLeatherSeats:"Interior",hasSplitRearSeats:"Interior",hasElectricFrontSeats:"Interior",hasLumbarSupport:"Interior",
  hasAmbientLighting:"Interior",
  hasRearCamera:"Safety",has360Camera:"Safety",hasAdaptiveCruiseControl:"Safety",hasEcall:"Safety",
  hasBlindSpotAssist:"Safety",hasParkingAssist:"Safety",hasRearCrossTrafficWarning:"Safety",hasRainLightSensor:"Safety",
  hasTrafficSignRecognition:"Safety",hasEmergencyBraking:"Safety",hasParkingSensors:"Safety",hasTpms:"Safety"
};
function humanizeEquipmentKey(key){
  const plain = key.replace(/^has/,"").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/([A-Za-z])(\d)/g,"$1 $2");
  return plain ? plain.charAt(0).toUpperCase()+plain.slice(1) : key;
}
function parseEquipmentAudit(raw){
  const text = String(raw||"").replaceAll("\u066b",",").replaceAll(/\s+/g," ").trim();
  const prefix = "audit override:";
  if(!text.toLocaleLowerCase().startsWith(prefix)) return {text,key:null,value:null};
  const payload = text.slice(prefix.length).trim(), split = payload.indexOf(" = ");
  const key = (split<0?payload:payload.slice(0,split)).trim();
  const value = split<0 ? null : payload.slice(split+3).trim();
  return /^\w+$/.test(key) ? {text,key,value} : {text,key:null,value:null};
}
function readableEquipmentItem(raw){
  const audit = parseEquipmentAudit(raw);
  if(!audit.key) return audit.text;
  const {key,value}=audit;
  if(key.startsWith("has")){
    if(value && /^(false|0|no)$/i.test(value)) return null;
    return EQUIPMENT_LABELS[key] || humanizeEquipmentKey(key);
  }
  return null;
}
function buildEquipmentGroups(equipment,delimiter,car){
  const groups = new Map(EQUIPMENT_CATEGORY_DEFS.map(def=>[def.title,{...def,items:[]}])) , seen = new Set();
  const technical = new Set([car.config_drive,car.engine,car.fuel,car.gearshift,car.cartype].filter(Boolean).map(x=>String(x).toLocaleLowerCase()));
  for(const source of EQUIPMENT_CATEGORY_DEFS){
    for(const raw of String(equipment[source.prop]||"").split(delimiter)){
      const audit=parseEquipmentAudit(raw), item=readableEquipmentItem(raw);
      if(!item) continue;
      const category=audit.key&&EQUIPMENT_CATEGORY_BY_KEY[audit.key] || source.title;
      const dedupe=item.toLocaleLowerCase();
      if(seen.has(dedupe)||technical.has(dedupe)) continue;
      seen.add(dedupe); groups.get(category).items.push(item);
    }
  }
  return Array.from(groups.values()).filter(group=>group.items.length);
}
async function downloadConfigPdf(c, button){
  const url = configPdfLink(c);
  if(!url) return;
  button.disabled = true;
  button.setAttribute("aria-busy","true");
  const templates = Array.from(new Set([state.cfg.proxy||"",ANYCORS].filter(Boolean)));
  let blob = null, lastError = null;
  try{
    for(const tpl of templates){
      try{
        const res = await fetchWithTimeout(proxied(url,tpl));
        if(!res.ok) continue;
        const candidate = await res.blob();
        if(candidate.size>0){ blob=candidate; break; }
      }catch(e){ lastError=e; }
    }
    if(!blob) throw lastError || new Error("PDF download failed");
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl; a.download = configPdfFilename(c);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),5000);
    toast("Configuration PDF downloaded");
  }catch(e){ console.warn("Configuration PDF download failed",e); toast("Download failed — use Open PDF instead"); }
  finally{ button.disabled=false; button.removeAttribute("aria-busy"); }
}

