"use strict";
/* ---------------- filter UI ---------------- */
function chipHtml(val,label,extra){ return `<button class="chip" data-chip="${esc(val)}">${esc(label)}${extra?` <span class="chip-count">${esc(extra)}</span>`:""}</button>`; }
function buildFilterUI(){
  const F = state.facets;
  $("#fuelChips").innerHTML = F.fuels.map(([v,n])=>chipHtml(v,displayValue("fuel",v),n)).join("");
  $("#typeChips").innerHTML = F.types.map(([v,n])=>chipHtml(v,displayValue("body",v),n)).join("");
  $("#gearChips").innerHTML = F.gears.map(([v,n])=>chipHtml(v,displayValue("gear",v),n)).join("");
  renderBrandList("");
  $("#colorSwatches").innerHTML = F.colors.map(([name,hex])=>
    `<button class="swatch" data-chip="${esc(name)}" title="${esc(name)}" aria-label="${esc(name)}"${vehicleColorStyle(hex)}></button>`).join("");
  const applyDebounced = debounce(apply, 140);
  initDualRange($("#priceRange"), {
    min: F.priceMin, max: F.priceMax, step: 10,
    labelLo: "Minimum monthly price", labelHi: "Maximum monthly price",
    onInput: (lo, hi, atMin, atMax) => {
      state.f.priceMin = atMin ? null : lo;
      state.f.priceMax = atMax ? null : hi;
      $("#priceMin").value = state.f.priceMin??""; $("#priceMax").value = state.f.priceMax??"";
      updateRangeOuts(); applyDebounced();
    }
  });
  initDualRange($("#powerRange"), {
    min: 0, max: F.powerMax, step: 5,
    labelLo: "Minimum power", labelHi: "Maximum power",
    onInput: (lo, hi, atMin, atMax) => {
      state.f.powerMin = atMin ? 0 : lo;
      state.f.powerMax = atMax ? null : hi;
      updateRangeOuts(); applyDebounced();
    }
  });
  const termValues = F.terms.length ? F.terms : [6, 12, 24];
  initDualRange($("#termRange"), {
    values: termValues,
    labelLo: "Shortest contract term", labelHi: "Longest contract term",
    onInput: (lo, hi, atMin, atMax) => {
      state.f.terms = (atMin && atMax) ? [] : termValues.filter(t=>t>=lo && t<=hi).map(String);
      updateRangeOuts(); applyDebounced();
    }
  });
  const seatValues = (F.seats||[]).map(Number).filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
  if (seatValues.length) initDualRange($("#seatRange"), {
    values: seatValues,
    labelLo: "Minimum seats", labelHi: "Maximum seats",
    onInput: (lo, hi, atMin, atMax) => {
      state.f.seats = (atMin && atMax) ? [] : seatValues.filter(v=>v>=lo && v<=hi).map(String);
      updateRangeOuts(); applyDebounced();
    }
  });
  const doorValues = (F.doors||[]).map(Number).filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
  if (doorValues.length) initDualRange($("#doorRange"), {
    values: doorValues,
    labelLo: "Minimum doors", labelHi: "Maximum doors",
    onInput: (lo, hi, atMin, atMax) => {
      state.f.doors = (atMin && atMax) ? [] : doorValues.filter(v=>v>=lo && v<=hi).map(String);
      updateRangeOuts(); applyDebounced();
    }
  });
  $("#rangeSlider").max = F.rangeMax; $("#rangeSlider").value = 0;
  syncRangeControls();
}
function renderBrandList(filterText){
  const q = filterText.toLowerCase();
  const live = state.liveBrandCounts;
  $("#brandList").innerHTML = state.facets.brands
    .filter(([b])=>!q||b.toLowerCase().includes(q))
    .map(([b,n])=>{
      const count = live ? (live.get(b)||0) : n;
      return `<label class="checkrow ${state.f.brands.includes("!"+b)?"ex":""}${count===0&&!state.f.brands.includes(b)&&!state.f.brands.includes("!"+b)?" dim":""}" title="Click: include \u00b7 again: exclude \u00b7 again: clear"><input type="checkbox" data-brand="${esc(b)}" ${state.f.brands.includes(b)?"checked":""}> ${esc(b)} <span class="cnt">${fmtNum(count)}</span></label>`;
    })
    .join("") || '<div class="filter-empty">No brand matches</div>';
  $$("#brandList [data-brand]").forEach(cb=>{ cb.indeterminate = state.f.brands.includes("!"+cb.dataset.brand); });
}
function updateRangeOuts(){
  syncPriceQuick();
  const f=state.f;
  $("#priceOut").textContent =
    f.priceMin==null && f.priceMax==null ? "any budget"
    : f.priceMin!=null && f.priceMax!=null ? `${fmtEur(f.priceMin)} – ${fmtEur(f.priceMax)} / month`
    : f.priceMax!=null ? `up to ${fmtEur(f.priceMax)} / month`
    : `from ${fmtEur(f.priceMin)} / month`;
  const ps = v => `${v} kW (${Math.round(v*1.35962)} PS)`;
  $("#powerOut").textContent =
    f.powerMin<=0 && f.powerMax==null ? "any"
    : f.powerMin>0 && f.powerMax!=null ? `${ps(f.powerMin)} – ${ps(f.powerMax)}`
    : f.powerMax!=null ? `≤ ${ps(f.powerMax)}`
    : `≥ ${ps(f.powerMin)}`;
  const terms = f.terms.map(Number);
  $("#termOut").textContent = terms.length
    ? (Math.min(...terms)===Math.max(...terms) ? `${terms[0]} months` : `${Math.min(...terms)} – ${Math.max(...terms)} months`)
    : "any";
  const rangeText = (arr, unit) => {
    const v = arr.map(Number).filter(Number.isFinite);
    if (!v.length) return "any";
    const lo = Math.min(...v), hi = Math.max(...v);
    return lo===hi ? `${lo} ${unit}` : `${lo} – ${hi} ${unit}`;
  };
  const seatOut = $("#seatOut"), doorOut = $("#doorOut");
  if (seatOut) seatOut.textContent = rangeText(f.seats, "seats");
  if (doorOut) doorOut.textContent = rangeText(f.doors, "doors");
  $("#rangeOut").textContent = f.rangeMin>0 ? `≥ ${fmtNum(f.rangeMin)} km` : "any";
}

/* ---------------- filtering & sorting ---------------- */
/* One predicate for filtering and for facet counting: `skip` names a facet
   whose own selection is ignored (counts then reflect all OTHER filters). */
function carPasses(c, skip){
  const f = state.f;
  const terms = f.terms.map(Number);
  const q = f.q.trim().toLowerCase();
  if (f.favOnly && !state.favs.has(carKey(c))) return false;
  if (q){
    const hay = [brandName(c), c.model, c.trim_name, c.equipment_line, c.engine, c.cartype, c.fuel, c.config&&c.config.name]
      .filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (skip!=="fuels" && !facetPass(f.fuels, c.fuel)) return false;
  if (skip!=="brands" && !facetPass(f.brands, brandName(c))) return false;
  if (skip!=="types" && !facetPass(f.types, c.cartype)) return false;
  if (skip!=="gears" && !facetPass(f.gears, c.gearshift)) return false;
  if (skip!=="seats" && !facetPass(f.seats, c.seats)) return false;
  if (skip!=="doors" && !facetPass(f.doors, c.doors)) return false;
  if (!facetPass(f.colors, c.color && c.color.specific)) return false;
  if (terms.length){
    const avail = new Set(priceList(c).map(x=>x.term));
    (Array.isArray(c.available_terms)?c.available_terms:[]).forEach(t=>avail.add(Number(t)));
    // colors of this version are separate configs and may offer other terms
    for (const cl of (Array.isArray(c.color_list)?c.color_list:[])){
      const rec = cl && cl.uid!=null ? siblingStockRec(cl.uid) : null;
      if (rec && Array.isArray(rec.tm)) rec.tm.forEach(t=>avail.add(Number(t)));
    }
    if (!terms.some(t=>avail.has(t))) return false;
  }
  // base-price fallback: a color sibling may carry the filtered term
  const p = minPrice(c, terms.length?terms:null) ?? minPrice(c);
  if (f.priceMin!=null && (p==null || p < f.priceMin)) return false;
  if (f.priceMax!=null && (p==null || p > f.priceMax)) return false;
  if (f.powerMin>0 && (Number(c.power)||0) < f.powerMin) return false;
  if (f.powerMax!=null && Number(c.power) > f.powerMax) return false;
  if (f.rangeMin>0 && (evRange(c)||0) < f.rangeMin) return false;
  if (f.deals && !hasDeal(c)) return false;
  if (f.hitch && !hasHitch(c)) return false;
  if (f.realPics && !c.has_real_pictures) return false;
  if (f.drops && !(c._drop>0)) return false;
  if (f.soon){
    const availability = FinnDomain.availabilityInfo(c.available_from);
    if (!availability.date || !availability.soon) return false;
  }
  return true;
}
function apply(){
  state.filtered = state.cars.filter(c=>carPasses(c, null));
  sortCars();
  refreshDisplayItems();
  state.renderCount = 0;
  renderGrid(true);
  renderStats();
  renderActiveFilters();
  updateFacetCounts();
  writeHash();
  if (state.userTouched && window.scrollY > 380) window.scrollTo({top:0, behavior:"smooth"});
}
/* Live facet counts: each group's numbers reflect all OTHER active filters. */
function updateFacetCounts(){
  if (!state.facets) return;
  state.liveBrandCounts = new Map();
  for (const c of state.cars) if (carPasses(c, "brands")){
    const b = brandName(c);
    state.liveBrandCounts.set(b, (state.liveBrandCounts.get(b)||0)+1);
  }
  $$("#brandList [data-brand]").forEach(cb=>{
    const row = cb.closest(".checkrow");
    const n = state.liveBrandCounts.get(cb.dataset.brand)||0;
    const cnt = row.querySelector(".cnt");
    if (cnt) cnt.textContent = fmtNum(n);
    row.classList.toggle("dim", n===0 && !cb.checked && !cb.indeterminate);
  });
  for (const [prop, sel, get] of [["fuels","#fuelChips",c=>c.fuel],["types","#typeChips",c=>c.cartype],["gears","#gearChips",c=>c.gearshift]]){
    const counts = new Map();
    for (const c of state.cars) if (carPasses(c, prop)){
      const v = String(get(c)??"").trim();
      if (v) counts.set(v, (counts.get(v)||0)+1);
    }
    $$(sel+" .chip").forEach(ch=>{
      const n = counts.get(ch.dataset.chip)||0;
      let span = ch.querySelector(".chip-count");
      if (!span){ span = document.createElement("span"); span.className = "chip-count"; ch.append(" ", span); }
      span.textContent = fmtNum(n);
      ch.classList.toggle("dim", n===0 && !ch.classList.contains("on") && !ch.classList.contains("ex"));
    });
  }
}
function sortCars(){
  const terms = state.f.terms.map(Number);
  const p = c => minPrice(c, terms.length?terms:null) ?? Infinity;
  const cmp = {
    "reco":       (a,b)=>(a.product_desktop_sorting??1e9)-(b.product_desktop_sorting??1e9),
    "added-desc": (a,b)=>((b._firstSeen??0)-(a._firstSeen??0)) || ((a._addedOrder??1e9)-(b._addedOrder??1e9)),
    "price-asc":  (a,b)=>p(a)-p(b),
    "price-desc": (a,b)=>p(b)-p(a),
    "drop-desc":  (a,b)=>(b._drop||0)-(a._drop||0),
    "power-desc": (a,b)=>(Number(b.power)||0)-(Number(a.power)||0),
    "range-desc": (a,b)=>(evRange(b)||0)-(evRange(a)||0),
    "avail-asc":  (a,b)=>(availDate(a)||new Date(8640000000000000))-(availDate(b)||new Date(8640000000000000)),
    "name-asc":   (a,b)=>carName(a).localeCompare(carName(b))
  }[state.sort] || (()=>0);
  state.filtered.sort(cmp);
}
function buildModelGroups(cars){
  const groups = new Map();
  for(const c of cars){
    const key = modelGroupKey(c);
    if(!groups.has(key)) groups.set(key,{key,brand:brandName(c),model:c.model||"Other model",versions:[]});
    groups.get(key).versions.push(c);
  }
  const terms = state.f.terms.map(Number);
  return Array.from(groups.values()).map(g=>{
    const prices = g.versions.map(c=>minPrice(c,terms.length?terms:null) ?? minPrice(c)).filter(p=>p!=null);
    const dated = g.versions.filter(c=>availDate(c)).sort((a,b)=>availDate(a)-availDate(b));
    g.representative = g.versions.find(c=>pictureUrl(c)) || g.versions[0];
    g.priceMin = prices.length ? Math.min(...prices) : null;
    g.priceMax = prices.length ? Math.max(...prices) : null;
    g.stockCount = aggregateStock(g.versions);
    // Listed configs carry only their own color's stock; sibling colors are
    // separate configs. Fold in every sibling stock the DB has resolved so far.
    const stockInfos = g.versions.map(versionStockInfo);
    if (stockInfos.some(i=>i.total!=null)) g.stockCount = stockInfos.reduce((s,i)=>s+(i.total||0),0);
    g.stockPartial = stockInfos.some(i=>!i.known);
    g.earliest = dated[0] || g.representative;
    g.trims = new Set(g.versions.map(c=>c.trim_name||c.equipment_line||c.engine).filter(Boolean));
    g.colors = new Set(g.versions.flatMap(c=>
      Array.isArray(c.color_list)&&c.color_list.length
        ? c.color_list.map(x=>x&&x.color_specific)
        : [c.color&&c.color.specific]
    ).filter(Boolean));
    return g;
  });
}
function refreshDisplayItems(){
  state.modelGroups = buildModelGroups(state.filtered);
  state.displayItems = state.cfg.browseMode==="models" ? state.modelGroups : state.filtered;
}

/* ---------------- rendering ---------------- */
function renderSkeletons(){
  const grid = $("#grid");
  grid.setAttribute("aria-busy","true");
  grid.innerHTML = Array.from({length:9},()=>'<div class="skel"><div class="a"></div><div class="b"></div></div>').join("");
  $("#moreBtn").hidden = true;
  $("#cnt").textContent = "–"; $("#cntSub").textContent=""; $("#stats").innerHTML=""; $("#activeFilters").innerHTML="";
}
const PAGE = 24;
const AUTO_LOAD = "IntersectionObserver" in window;
let autoFillScheduled = false;
function hasMoreResults(){ return state.renderCount < state.displayItems.length; }
function sentinelNearViewport(){
  const sentinel = $("#sentinel");
  return sentinel && sentinel.getBoundingClientRect().top <= window.innerHeight + 600;
}
function scheduleAutoFill(){
  if (!AUTO_LOAD || state.loading || autoFillScheduled || !hasMoreResults()) return;
  autoFillScheduled = true;
  requestAnimationFrame(()=>{
    let batches = 0;
    while (!state.loading && hasMoreResults() && sentinelNearViewport() && batches < 10){
      renderGrid(false);
      batches++;
    }
    autoFillScheduled = false;
    if (!state.loading && hasMoreResults() && sentinelNearViewport()) scheduleAutoFill();
  });
}
function renderGrid(reset){
  const grid = $("#grid");
  grid.setAttribute("aria-busy","false");
  if (reset) grid.innerHTML = "";
  if (!state.cars.length){
    // the API answered, but this view has no vehicles at all (e.g. "coming soon" is often empty)
    grid.innerHTML = `<div class="empty"><div class="big"><svg class="ic" aria-hidden="true"><use href="#i-inbox"/></svg></div>The API returned <b>no vehicles</b> for the view "<b>${esc(state.cfg.view)}</b>" — that bucket is currently empty on FINN's side.<br>
      Tip: switch back to <b>Available cars</b> and use the <b>"Available within 4 weeks"</b> filter instead.<br><br>
      <button class="chip" id="emptyView">Open Settings</button></div>`;
    const s=$("#emptyView"); if(s) s.addEventListener("click", openSettings);
    $("#moreBtn").hidden = true;
    return;
  }
  if (!state.filtered.length){
    grid.innerHTML = `<div class="empty"><div class="big"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg></div>No vehicles match the current filters.<br><br>
      <button class="chip" id="emptyReset">Reset filters</button></div>`;
    const b=$("#emptyReset"); if(b) b.addEventListener("click", resetFilters);
    $("#moreBtn").hidden = true;
    return;
  }
  const slice = state.displayItems.slice(state.renderCount, state.renderCount+PAGE);
  const frag = document.createDocumentFragment();
  const els = slice.map(item => item.versions ? modelCardEl(item) : cardEl(item));
  els.forEach(el=>frag.appendChild(el));
  grid.appendChild(frag);
  els.forEach((el,i)=>{ if(!slice[i].versions) autoSelectMatchingColor(el, slice[i]); });
  requestAnimationFrame(balancePalettes);
  state.renderCount += slice.length;
  $("#moreBtn").hidden = !hasMoreResults() || AUTO_LOAD;
  $("#moreBtn").textContent = `Show more  (${fmtNum(state.displayItems.length-state.renderCount)} remaining)`;
  scheduleAutoFill();
}
function cardCarouselMarkup(pics,label){
  if(pics.length<2) return "";
  const dots=pics.slice(0,8).map((p,i)=>`<i class="${i===0?"on":""}"></i>`).join("");
  return `<button class="navarr prev" data-shot="-1" aria-label="Previous ${esc(label)} photo"><svg class="ic" aria-hidden="true"><use href="#i-left"/></svg></button><button class="navarr next" data-shot="1" aria-label="Next ${esc(label)} photo"><svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></button><div class="dots">${dots}</div><span class="shots">1/${pics.length}</span>`;
}
/* Terms available across ALL colors of a version (own + resolved siblings). */
function versionTermsList(c){
  const terms = new Set(carTermsList(c));
  const selfUid = String(c.uid ?? carKey(c));
  for (const cl of (Array.isArray(c.color_list)?c.color_list:[])){
    const uid = cl && cl.uid!=null ? String(cl.uid) : null;
    if (!uid || uid===selfUid) continue;
    const rec = siblingStockRec(uid);
    if (rec && Array.isArray(rec.tm)) rec.tm.forEach(t=>terms.add(Number(t)));
  }
  return Array.from(terms).filter(Boolean).sort((a,b)=>a-b);
}
/* Does a color sibling satisfy the active term/price/power filters?
   Unknown data fails open so colors are never hidden by missing info. */
function variantMatchesFilters(cl){
  const f = state.f;
  const uid = cl && cl.uid!=null ? String(cl.uid) : null;
  const terms = f.terms.map(Number);
  const full = uid ? (state.cars.find(x=>String(x.uid??"")===uid) || cachedConfigByUid(uid)) : null;
  if (terms.length){
    const rec = uid ? siblingStockRec(uid) : null;
    const tm = full ? carTermsList(full) : (rec && Array.isArray(rec.tm) ? rec.tm : null);
    if (Array.isArray(tm) && tm.length && !terms.some(t=>tm.includes(t))) return false;
  }
  if (full){
    if (f.priceMin!=null || f.priceMax!=null){
      const p = minPrice(full, terms.length?terms:null) ?? minPrice(full);
      if (f.priceMin!=null && (p==null || p < f.priceMin)) return false;
      if (f.priceMax!=null && (p==null || p > f.priceMax)) return false;
    }
    if (f.powerMin>0 && (Number(full.power)||0) < f.powerMin) return false;
    if (f.powerMax!=null && Number(full.power) > f.powerMax) return false;
  }
  return true;
}
/* ---------------- sharing: deterministic deep links on every layer -------- */
function buildShareUrl(params){
  const u = new URL(location.href);
  const h = new URLSearchParams((u.hash||"").replace(/^#/,""));
  for (const [k,v] of Object.entries(params)){ if (v==null) h.delete(k); else h.set(k, v); }
  u.hash = h.toString();
  return u.toString();
}
async function shareLink(url, label="Link"){
  try{
    if (navigator.share && matchMedia("(pointer: coarse)").matches){ await navigator.share({url}); return; }
  }catch(e){ if (e && e.name==="AbortError") return; }
  try{ await navigator.clipboard.writeText(url); toast(`${label} copied`); }
  catch(e){ toast("Couldn't copy automatically — use the address bar URL"); }
}
/* Open a shared deep link (car/color/model) once the catalog is ready.
   Uses the hash captured at boot — writeHash scrubs the URL on first apply. */
async function openFromHash(){
  const h = new URLSearchParams(String(state.bootHash||"").replace(/^#/,""));
  state.bootHash = null;
  const carId = h.get("car"), cc = h.get("cc"), model = h.get("model");
  if (model){
    const g = state.modelGroups.find(x=>x.key===model || decodeURIComponent(x.key)===model);
    if (g) openVersions(g);
  }
  if (carId){
    let c = state.cars.find(x=>carKey(x)===carId || String(x.uid??"")===carId);
    if (!c) c = await fetchConfigByUid(carId);
    if (c) openDetail(c, cc?{colorUid:cc}:{});
    else toast("The shared configuration is no longer listed");
  }
}
/* Cars occupy wildly different fractions of their renders — measure the
   content box once per URL on a tiny CORS canvas, then scale/shift each
   <img> so the car fills its frame WITHOUT sliding under the overlay
   buttons (top strip) or the color dots (bottom strip). */
function measureImageContent(src){
  const cache = measureImageContent._cache || (measureImageContent._cache = new Map());
  if (cache.has(src)) return cache.get(src);
  const p = new Promise(resolve=>{
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      try{
        const w = 64, h = 40;
        const cv = measureImageContent._cv || (measureImageContent._cv = document.createElement("canvas"));
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", {willReadFrequently: true});
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(probe, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
          const i = (y*w + x) * 4;
          if (d[i+3] > 16 && !(d[i] > 242 && d[i+1] > 242 && d[i+2] > 242)){
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        if (maxX < minX || maxY < minY){ resolve({fw:1, fh:1, cy:0.5}); return; }
        resolve({ fw:(maxX-minX+1)/w, fh:(maxY-minY+1)/h, cy:(minY+maxY+1)/2/h });
      }catch(e){ cache.delete(src); resolve(null); }   // tainted — retry later
    };
    probe.onerror = () => { cache.delete(src); resolve(null); };
    probe.src = src;
  });
  cache.set(src, p);
  return p;
}
const HERO_PROFILES = {
  /* cards: content ends up spanning ~[0.27..0.85] of the box height, clear of
     the 34px button strip above and the color dots below */
  card:   { max: 1.40, tw: 0.94, th: 0.70, center: 0.47, clamp: 0.20 },
  detail: { max: 1.30, tw: 0.94, th: 0.84, center: 0.50, clamp: 0 }
};
function normalizeHeroScale(img, profile="card"){
  const src = img.currentSrc || img.src;
  if (!src || src.startsWith("data:")) return;
  measureImageContent(src).then(mm=>{
    if (!mm || !img.isConnected || (img.currentSrc||img.src)!==src) return;
    const p = HERO_PROFILES[profile] || HERO_PROFILES.card;
    const s = Math.max(1, Math.min(p.max, p.tw/mm.fw, p.th/mm.fh));
    let ty = 0;
    if (p.clamp > 0 && s > 1.001){
      ty = p.center - 0.5 - (mm.cy - 0.5)*s;
      ty = Math.max(-p.clamp, Math.min(p.clamp, ty));
    }
    img.style.setProperty("--hero-scale", s.toFixed(3));
    img.style.setProperty("--hero-ty", (ty*100).toFixed(2)+"%");
  });
}
/* Fullscreen zoomable gallery: large stage, thumb strip, arrows, click-to-zoom
   (origin follows the pointer while zoomed). Works above the detail dialog. */
function openLightbox(pics, idx=0, alt="Vehicle photo", onNavigate){
  const urls = (pics||[]).map(p=>typeof p==="string"?p:p&&p.url).filter(Boolean);
  if (!urls.length) return;
  const dlg = $("#lightboxDlg"), img = $("#lbMain"), thumbs = $("#lbThumbs");
  let i = Math.min(Math.max(idx,0), urls.length-1);
  img.alt = alt;
  const unzoom = ()=>{ img.classList.remove("zoomed"); img.style.transformOrigin = ""; };
  const set = n => {
    i = ((n % urls.length) + urls.length) % urls.length;
    unzoom();
    img.src = urls[i];
    $("#lbCount").textContent = `${i+1} / ${urls.length}`;
    thumbs.querySelectorAll("img").forEach((t,ix)=>t.classList.toggle("on", ix===i));
    const on = thumbs.querySelector("img.on");
    if (on) on.scrollIntoView({block:"nearest", inline:"nearest"});
    if (onNavigate) onNavigate(i);
  };
  thumbs.innerHTML = urls.length>1 ? urls.map((u,ix)=>`<img data-lb="${ix}" alt="${esc(alt)} view ${ix+1}" loading="lazy">`).join("") : "";
  thumbs.querySelectorAll("img").forEach(t=>{
    t.src = urls[Number(t.dataset.lb)];
    t.addEventListener("error", ()=>{ t.src = PLACEHOLDER; }, {once:true});
    t.addEventListener("click", ()=>set(Number(t.dataset.lb)));
  });
  dlg.querySelectorAll("[data-lb-step]").forEach(b=>{ b.hidden = urls.length<2; });
  dlg._step = d => { if (urls.length<2) return false; set(i+d); return true; };
  set(i);
  if (!dlg.open) dlg.showModal();
}
/* finn.com-style mini color palette; clicking a swatch previews that color.
   Single-color cars show their one color so the absence of choice is explicit. */
function paletteHtml(c, limit=6, dotsCount=0){
  const selfUid = String(c.uid ?? carKey(c));
  const rawList = Array.isArray(c.color_list) ? c.color_list.filter(Boolean) : [];
  // the listed color is filtered like any other — the card auto-presents a
  // matching sibling when its own color fails the active filters
  let list = rawList.filter(cl=>variantMatchesFilters(cl));
  if (!list.length) list = rawList;   // nothing known to match: fail open
  if (!list.length && c.color && (c.color.specific || c.color.color_hex)){
    list = [{ uid: c.uid ?? carKey(c), color_specific: c.color.specific, color_hex: c.color.color_hex }];
  }
  if (!list.length) return "";
  const single = list.length === 1;
  const shown = list.slice(0, limit);
  const more = list.length - shown.length;
  return `<div class="cpalette" role="group" aria-label="Available colors" style="--palmax:${palMaxFor(dotsCount)}">${shown.map(cl=>{
    const uid = cl && cl.uid!=null ? String(cl.uid) : "";
    const on = uid===selfUid;
    const name = cl.color_specific || "Color";
    return `<button class="cpal${on?" on":""}" data-pal="${esc(uid)}" title="${esc(name)}${single?" — only color":on?" — shown":""}" aria-label="Show ${esc(name)}" aria-pressed="${on}"${vehicleColorStyle(cl.color_hex)}></button>`;
  }).join("")}${more>0?`<span class="cpal-more">+${more}</span>`:""}</div>`;
}
/* how far the color dots may extend before touching the always-centered
   photo dots: half the dot strip width plus a small breathing gap */
function palMaxFor(dotsCount){
  if (!dotsCount || dotsCount < 2) return "calc(100% - 1.2rem)";
  const half = Math.ceil((15 + (Math.min(dotsCount,8)-1) * 9.5) / 2);
  return `calc(50% - ${half + 9}px)`;
}
/* When a color row has to wrap, split it near 50/50 instead of leaving a
   lonely swatch on the second line. */
function balancePalettes(){
  document.querySelectorAll(".imgwrap > .cpalette, .vimg > .cpalette").forEach(el=>{
    el.style.inlineSize = "";
    const items = [...el.children];
    if (items.length < 3 || el.clientHeight <= 26) return;   // fits on one line
    const k = Math.ceil(items.length / 2);
    const gap = 4.8;
    const width = items.slice(0, k).reduce((s,it)=>s+it.getBoundingClientRect().width, 0) + (k-1)*gap;
    el.style.inlineSize = `${Math.ceil(width) + 2}px`;
  });
}
/* page width stages, adapted to the real viewport: only offer steps that
   differ meaningfully (~900px apart), up to 4 on ultrawides. The middle
   stages are literal fractions between standard and full. */
const WIDE_BASE = 1780;
function wideStages(){
  const full = window.innerWidth;
  if (full <= WIDE_BASE + 300) return [WIDE_BASE];          // FHD & below: one width
  const n = Math.min(4, Math.max(2, 1 + Math.round((full - WIDE_BASE) / 900)));
  return Array.from({length: n}, (_,i)=>Math.round(WIDE_BASE + i * (full - WIDE_BASE) / (n - 1)));
}
function applyWide(){
  const stages = wideStages();
  const btn = $("#wideBtn");
  if (stages.length < 2){
    document.body.style.removeProperty("--layout-w");
    if (btn){ btn.hidden = true; btn.classList.remove("on"); }
    return;
  }
  const idx = Math.min(Number(state.cfg.wide) || 0, stages.length - 1);
  document.body.style.setProperty("--layout-w", idx === stages.length - 1 ? "100%" : stages[idx] + "px");
  if (btn){
    btn.hidden = false;
    btn.classList.toggle("on", idx > 0);
    btn.title = `Cycle page width (${idx+1}/${stages.length}: ${idx===0?"standard":idx===stages.length-1?"full":fmtNum(stages[idx])+"px"})`;
  }
}
function wideLabel(){
  const stages = wideStages();
  const idx = Math.min(Number(state.cfg.wide) || 0, stages.length - 1);
  return idx===0 ? "Standard width" : idx===stages.length-1 ? "Full width" : `Wide · ${fmtNum(stages[idx])}px`;
}
/* In-place color preview on result/version cards: swap the carousel to the
   chosen color and remember it so opening the card targets that variant. */
function applyCardPalette(card, btn){
  const key = card.dataset.key || card.dataset.version;
  const c = state.cars.find(x=>carKey(x)===key);
  if (!c) return;
  const uid = btn.dataset.pal || "";
  const selfUid = String(c.uid ?? carKey(c));
  const cl = (Array.isArray(c.color_list)?c.color_list:[]).find(x=>String(x&&x.uid)===uid);
  card._palUid = uid && uid!==selfUid ? uid : null;
  card.querySelectorAll(".cpal").forEach(x=>{ x.classList.toggle("on", x===btn); x.setAttribute("aria-pressed", String(x===btn)); });
  const nameEl = card.querySelector("[data-pal-name]");
  if (nameEl && cl && cl.color_specific) nameEl.textContent = cl.color_specific;
  let newPics = null;
  if (!card._palUid) newPics = galleryPics(c);
  else {
    const sibling = state.cars.find(x=>String(x.uid??"")===uid);
    if (sibling) newPics = galleryPics(sibling);
    else {
      const vp = (Array.isArray(cl&&cl.pictures)&&cl.pictures.length ? cl.pictures.map(p=>(p&&p.url)||p) : [cl&&cl.picture_front_url])
        .filter(u=>typeof u==="string"&&u);
      if (vp.length) newPics = vp;
    }
  }
  if (!newPics){ toast(`${(cl&&cl.color_specific)||"This color"} isn't listed yet — open the card for what's known`); return; }
  card._pics = newPics; card._shot = 0;
  const hero = card.querySelector("img.hero");
  if (hero){
    hero.classList.remove("loaded");
    hero.addEventListener("error", ()=>{ hero.src = PLACEHOLDER; }, {once:true});
    hero.src = newPics[0] || PLACEHOLDER;
  }
  const dots = card.querySelector(".dots");
  if (dots) dots.innerHTML = newPics.slice(0,8).map((p,i)=>`<i class="${i===0?"on":""}"></i>`).join("");
  const shots = card.querySelector(".shots");
  if (shots) shots.textContent = `1/${newPics.length}`;
  // Colors are configs of their own — reflect the variant's price, availability
  // and stock on the card (live once a fetched sibling resolves).
  const applyCarData = (src)=>{
    if (!src || !card.isConnected) return;
    setCardPreviewState(card, false);
    const terms = state.f.terms.map(Number);
    const p = minPrice(src, terms.length?terms:null) ?? minPrice(src);
    const priceEl = card.querySelector(".price .val") || card.querySelector(".vprice");
    if (priceEl && p!=null) priceEl.innerHTML = `${fmtEur(p)}<small> /month</small>`;
    const av = availLabel(src);
    const availTxt = av.txt==="available now" ? '<span class="now">available now</span>' : esc(av.txt);
    const cardAvail = card.querySelector(".avail");
    if (cardAvail){
      const tl = carTermsList(src);
      cardAvail.innerHTML = `${availTxt}<div class="terms" title="Contract terms of this color">${tl.length?esc(tl.join("/"))+" mo":""}</div>`;
    }
    const vAvail = card.querySelector(".vavail");
    if (vAvail) vAvail.innerHTML = availTxt;
    const n = stockCount(src);
    const stockEl = card.querySelector(".card-stock");
    if (stockEl && n!=null){
      stockEl.querySelector("strong").textContent = fmtNum(n);
      stockEl.querySelector("span").textContent = n===1?"car":"cars";
    }
  };
  if (!card._palUid) applyCarData(c);
  else {
    const sibling = state.cars.find(x=>String(x.uid??"")===uid);
    if (sibling) applyCarData(sibling);
    else fetchConfigByUid(uid).then(car=>{
      if (card._palUid!==uid) return;
      if (car) applyCarData(car);
      else setCardPreviewState(card, true, cl);   // not bookable yet — grey the numbers
    });
  }
}
/* Grey a card's price when the selected color has no published pricing yet. */
function setCardPreviewState(card, on, cl){
  card.classList.toggle("price-preview", on);
  const incl = card.querySelector(".price .incl");
  if (incl){
    if (card._inclText==null) card._inclText = incl.textContent;
    incl.textContent = on ? `no pricing published yet${cl&&cl.availability_date?` · expected ${fmtDate(cl.availability_date)}`:""}` : card._inclText;
  }
  const priceWrap = card.querySelector(".price") || card.querySelector(".vprice");
  if (priceWrap) priceWrap.title = on ? `${(cl&&cl.color_specific)||"This color"} isn't bookable yet — the shown price belongs to the previously selected color` : "";
  if (on){
    const availEl = card.querySelector(".avail") || card.querySelector(".vavail");
    if (availEl && cl && cl.availability_date) availEl.innerHTML = `from ${esc(fmtDate(cl.availability_date))}`;
  }
}
/* When the displayed (listed) color itself fails the active term filter but a
   sibling color is KNOWN to match, present that sibling on the card automatically. */
function autoSelectMatchingColor(card, c){
  const termsF = state.f.terms.map(Number);
  if (!termsF.length || !card) return;
  const ownTm = carTermsList(c);
  if (termsF.some(t=>ownTm.includes(t))) return;
  const selfUid = String(c.uid ?? carKey(c));
  const knownTerms = cl => {
    const uid = cl && cl.uid!=null ? String(cl.uid) : null;
    if (!uid) return null;
    const full = state.cars.find(x=>String(x.uid??"")===uid) || cachedConfigByUid(uid);
    if (full) return carTermsList(full);
    const rec = siblingStockRec(uid);
    return rec && Array.isArray(rec.tm) ? rec.tm : null;
  };
  const match = (Array.isArray(c.color_list)?c.color_list:[]).find(cl=>{
    if (!cl || String(cl.uid)===selfUid) return false;
    const tm = knownTerms(cl);
    return Array.isArray(tm) && termsF.some(t=>tm.includes(t)) && variantMatchesFilters(cl);
  });
  if (!match || match.uid==null) return;
  const btn = card.querySelector(`.cpal[data-pal="${CSS.escape(String(match.uid))}"]`);
  if (btn) applyCardPalette(card, btn);
}
function modelCardEl(group){
  const c = group.representative;
  const versionLabel = group.versions.length===1 ? "version" : "versions";
  const inventoryLabel = stockText(group.stockCount);
  const el = document.createElement("article");
  el.className = "card model-card"; el.dataset.group = group.key;
  const openLabel=`Open ${group.brand} ${group.model}, ${inventoryLabel?inventoryLabel+", ":""}${group.versions.length} ${versionLabel}`;
  const logo = brandLogo(c), av = availLabel(group.earliest);
  // One shot per distinct color across the group — the carousel then rotates
  // through the model's whole color range instead of one config's photos.
  const colorShots = [];
  {
    const seen = new Set();
    outer: for (const v of group.versions){
      for (const cl of (Array.isArray(v.color_list)?v.color_list:[])){
        const name = (cl && cl.color_specific) || "";
        if (!name || seen.has(name)) continue;
        if (!variantMatchesFilters(cl)) continue;
        const sib = state.cars.find(x=>String(x.uid??"")===String(cl && cl.uid));
        const url = sib ? galleryPics(sib)[0] : (cl && cl.picture_front_url);
        if (typeof url !== "string" || !url) continue;
        seen.add(name);
        colorShots.push({url, name, hex: cl.color_hex});
        if (colorShots.length >= 8) break outer;
      }
    }
    if (!colorShots.length){
      const cl0 = group.versions.flatMap(v=>Array.isArray(v.color_list)?v.color_list:[]).find(x=>x&&(x.color_specific||x.color_hex));
      if (cl0) colorShots.push({url: null, name: cl0.color_specific || "Color", hex: cl0.color_hex});
      else if (c.color && (c.color.specific || c.color.color_hex)) colorShots.push({url: null, name: c.color.specific || "Color", hex: c.color.color_hex});
    }
  }
  const useColors = colorShots.length >= 2;
  const pics = useColors ? colorShots.map(s=>s.url) : galleryPics(c);
  const powers = group.versions.map(x=>Number(x.power)).filter(x=>x>0).map(x=>Math.round(x*1.35962));
  const ranges = group.versions.map(evRange).filter(x=>x>0);
  const gears = displayValues("gear",group.versions.map(x=>x.gearshift).filter(Boolean));
  const bodies = displayValues("body",group.versions.map(x=>x.cartype).filter(Boolean));
  const range = values => values.length ? (Math.min(...values)===Math.max(...values)?fmtNum(values[0]):`${fmtNum(Math.min(...values))}–${fmtNum(Math.max(...values))}`) : null;
  const specs = [
    ranges.length ? {ic:"i-bolt",txt:`${range(ranges)} km`,cls:"ev"} : {ic:"i-fuel",txt:displayValues("fuel",group.versions.map(x=>x.fuel).filter(Boolean)).join(" / ")},
    gears.length ? {ic:"i-gear",txt:gears.join(" / ")} : null,
    powers.length ? {ic:"i-gauge",txt:`${range(powers)} PS`} : null,
    bodies.length ? {ic:"i-car",txt:bodies.join(" / ")} : null
  ].filter(x=>x&&x.txt);
  const meta = [group.trims.size?`${group.trims.size} ${group.trims.size===1?"trim":"trims"}`:null,group.colors.size?`${group.colors.size} ${group.colors.size===1?"color":"colors"}`:null].filter(Boolean).join(" · ");
  const palMarkup = colorShots.length?`<div class="cpalette" role="group" aria-label="Colors across versions" style="--palmax:${palMaxFor(pics.length)}">${colorShots.map((s,i)=>`<button class="cpal${i===0?" on":""}" data-pal-idx="${i}" title="${esc(s.name)}${colorShots.length===1?" — only color":""}" aria-label="Show ${esc(s.name)}" aria-pressed="${i===0}"${vehicleColorStyle(s.hex)}></button>`).join("")}${group.colors.size>colorShots.length?`<span class="cpal-more">+${group.colors.size-colorShots.length}</span>`:""}</div>`:"";
  el.innerHTML = `
    <button class="card-open" data-open-group aria-label="${esc(openLabel)}"></button>
    <div class="cardbar">
      <div class="badges"><span class="badge group-count">${fmtNum(group.versions.length)} ${versionLabel}</span></div>
      <div class="actions">
        <button class="sharebtn" data-share-model="${esc(group.key)}" title="Share this model overview" aria-label="Share this model overview"><svg class="ic" aria-hidden="true"><use href="#i-link"/></svg></button>
      </div>
    </div>
    <div class="imgwrap">
      <img class="hero" alt="${esc(group.brand+" "+group.model)}" loading="lazy">
      ${state.cfg.largePalette?"":palMarkup}
      ${cardCarouselMarkup(pics,"model")}
    </div>
    <div class="cbody">
      ${state.cfg.largePalette?palMarkup:""}
      <div class="chead">
        ${logo?`<img class="blogo" src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">`:""}
        <div class="txt"><div class="ctitle"><span class="bm">${esc(group.brand+" "+group.model)}</span></div><div class="ctrim">${esc(meta)}</div></div>
        ${group.stockCount==null?"":`<div class="card-stock" title="${group.stockPartial?"Stock across listed configurations and resolved color variants — some colors not yet fetched":"Customer-visible stock across all colors of the matching versions"}; availability dates still apply"><strong>${fmtNum(group.stockCount)}${group.stockPartial?"+":""}</strong><span>${group.stockCount===1&&!group.stockPartial?"car":"cars"}</span></div>`}
      </div>
      <div class="specrow">${specs.map(s=>`<span class="spec ${s.cls||""}"><svg class="ic" aria-hidden="true"><use href="#${s.ic}"/></svg><span>${esc(s.txt)}</span></span>`).join("")}</div>
      <div class="cfoot">
        <div class="price"><div class="from">from · ${fmtNum(state.cfg.km)} km/mo</div><div class="val">${fmtEur(group.priceMin)}<small> /month</small></div><div class="incl">across matching versions</div></div>
        <div class="avail"><div>${av.txt==="available now"?'<span class="now">available now</span>':esc(av.txt)}</div><span class="model-cta">Explore versions <svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></span></div>
      </div>
    </div>`;
  const img = el.querySelector("img.hero");
  img.addEventListener("load",()=>{ img.classList.add("loaded"); normalizeHeroScale(img); });
  img.addEventListener("error",()=>{img.src=PLACEHOLDER;},{once:true});
  img.src = pics[0] || PLACEHOLDER;
  el._pics=pics; el._shot=0;
  return el;
}
function versionCardEl(c){
  const key = carKey(c), price = minPrice(c), av = availLabel(c), inventory = stockCount(c);
  const vsi = versionStockInfo(c);
  const pics = galleryPics(c);
  const el = document.createElement("article");
  el.className = "version-card"; el.dataset.version = key;
  const title = c.trim_name || c.equipment_line || (c.config&&c.config.name) || c.engine || "Standard";
  const openLabel=`Open ${carName(c)} ${title}, ${stockText(inventory)?stockText(inventory)+", ":""}${fmtEur(price)} per month`;
  const metaParts = [c.engine, displayValue("drive",c.config_drive)].filter(Boolean);
  const metaColor = c.color && c.color.specific;
  const metaHtml = metaParts.length || metaColor
    ? `${esc(metaParts.join(" · "))}${metaColor?`${metaParts.length?" · ":""}<span data-pal-name>${esc(metaColor)}</span>`:""}`
    : esc([displayValue("fuel",c.fuel),displayValue("body",c.cartype)].filter(Boolean).join(" · "));
  const chips = [
    Array.isArray(c.color_list)&&c.color_list.length>1?`${c.color_list.length} colors`:null,
    c.model_year,
    c.power?`${Math.round(c.power*1.35962)} PS`:null,
    evRange(c)?`${fmtNum(evRange(c))} km`:null,
    displayValue("gear",c.gearshift)
  ].filter(Boolean).slice(0,5);
  el.innerHTML = `
    <button class="card-open" data-open-version aria-label="${esc(openLabel)}"></button>
    <div class="cardbar">
      <div class="badges"></div>
      <div class="actions">
        <button class="sharebtn" data-share-key="${esc(key)}" title="Share this configuration" aria-label="Share this configuration"><svg class="ic" aria-hidden="true"><use href="#i-link"/></svg></button>
        <button class="favbtn ${state.favs.has(key)?"on":""}" data-fav="${esc(key)}" title="Favorite" aria-label="Toggle favorite" aria-pressed="${state.favs.has(key)}"><svg class="ic" aria-hidden="true"><use href="#i-heart"/></svg></button>
        <button class="cmpbtn ${state.compare.includes(key)?"on":""}" data-cmp="${esc(key)}" title="Add to compare" aria-label="Add to compare" aria-pressed="${state.compare.includes(key)}"><svg class="ic" aria-hidden="true"><use href="#i-compare"/></svg></button>
      </div>
    </div>
    <div class="vimg">
      <img class="hero" alt="${esc(carName(c)+" "+title)}" loading="lazy">
      ${state.cfg.largePalette?"":paletteHtml(c, 6, pics.length)}
      ${cardCarouselMarkup(pics,"version")}
    </div>
    <div class="vbody">
      ${state.cfg.largePalette?paletteHtml(c):""}
      <div class="vtitle">${esc(title)}</div>
      <div class="vmeta">${metaHtml}</div>
      <div class="vchips">${c._isNew?`<span class="new-chip" title="First seen by this tool on ${esc(fmtDateTime(c._firstSeen))}">new</span>`:""}${vsi.total==null?"":`<span class="stock-chip" title="${vsi.known?"Customer-visible stock across all colors of this version":"Stock across resolved colors — some colors not yet fetched"}; availability dates still apply">${fmtNum(vsi.total)}${vsi.known?"":"+"} ${vsi.total===1&&vsi.known?"car":"cars"}</span>`}${chips.map(x=>`<span>${esc(x)}</span>`).join("")}</div>
      <div class="vfoot"><div class="vprice">${fmtEur(price)}<small> /month</small></div><div class="vavail">${av.txt==="available now"?'<span class="now">available now</span>':esc(av.txt)}</div></div>
    </div>`;
  const img = el.querySelector(".vimg>img");
  img.addEventListener("load", ()=>normalizeHeroScale(img));
  img.addEventListener("error",()=>{img.src=PLACEHOLDER;},{once:true});
  img.src = pics[0] || PLACEHOLDER;
  el._pics=pics; el._shot=0;
  return el;
}
function findModelGroup(key){ return state.modelGroups.find(g=>g.key===key); }
function openVersions(group){
  if(!group) return;
  state.activeGroupKey = group.key;
  const dlg = $("#versionsDlg"), logo = brandLogo(group.representative);
  dlg.setAttribute("aria-label", `${group.brand} ${group.model} versions`);
  const prices = group.versions.map(c=>minPrice(c)).filter(p=>p!=null);
  const priceText = prices.length ? (Math.min(...prices)===Math.max(...prices)?fmtEur(prices[0]):`${fmtEur(Math.min(...prices))}–${fmtEur(Math.max(...prices))}`) : "on request";
  dlg.innerHTML = `
    <div class="dhead versions-head">
      <div class="model-id">${logo?`<img class="blogo" src="${esc(logo)}" alt="" onerror="this.remove()">`:""}<div><div class="t">${esc(group.brand+" "+group.model)}</div><div class="s">Choose a version to see full pricing, equipment and colors</div></div></div>
      <div class="dnav">
        <button class="iconbtn" data-share-model="${esc(group.key)}" title="Share this model overview" aria-label="Share this model overview"><svg class="ic" aria-hidden="true"><use href="#i-link"/></svg></button>
        <button class="iconbtn x" data-close="versionsDlg" aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
    </div>
    <div class="dbody">
      <div class="versions-summary">${group.stockCount==null?"":`<span class="pilllet stock-summary" title="${group.stockPartial?"Stock across listed configurations and resolved color variants — some colors not yet fetched":"Customer-visible stock across all colors of the matching versions"}; availability dates still apply"><b>${fmtNum(group.stockCount)}${group.stockPartial?"+":""}</b> ${group.stockCount===1&&!group.stockPartial?"car":"cars"}</span>`}<span class="pilllet"><b>${fmtNum(group.versions.length)}</b> matching ${group.versions.length===1?"version":"versions"}</span>${group.colors.size?`<span class="pilllet"><b>${fmtNum(group.colors.size)}</b> ${group.colors.size===1?"color":"colors"}</span>`:""}<span class="pilllet">from <b>${priceText}</b> / month</span><span>Current filters and sorting are preserved</span></div>
      <div class="version-grid"></div>
    </div>`;
  const grid = dlg.querySelector(".version-grid"), frag = document.createDocumentFragment();
  const vEls = group.versions.map(c=>versionCardEl(c));
  vEls.forEach(el=>frag.appendChild(el));
  grid.appendChild(frag);
  vEls.forEach((el,i)=>autoSelectMatchingColor(el, group.versions[i]));
  requestAnimationFrame(balancePalettes);
  if(!dlg.open) dlg.showModal();
  dlg.querySelector(".dbody").scrollTop = 0;
}
function openVersionDetail(key, colorUid){
  const group = findModelGroup(state.activeGroupKey);
  if(!group) return;
  const c = group.versions.find(x=>carKey(x)===key);
  if(!c) return;
  $("#versionsDlg").close();
  openDetail(c,{list:group.versions,groupKey:group.key,colorUid});
}
function cardEl(c){
  const key = carKey(c);
  const terms = state.f.terms.map(Number);
  // fall back to the base price when only a color sibling carries the filtered term
  const price = minPrice(c, terms.length?terms:null) ?? minPrice(c);
  const inventory = stockCount(c);
  const av = availLabel(c);
  const label = displayProductLabel(c.product_label&&c.product_label.label);
  const el = document.createElement("article");
  el.className = "card"; el.dataset.key = key;
  const openLabel=`Open ${carName(c)}${stockText(inventory)?`, ${stockText(inventory)}`:""} details`;
  const specs = [
    isEV(c) ? {ic:"i-bolt", txt:evRange(c)?`${fmtNum(evRange(c))} km`:"Electric", cls:"ev"} : {ic:"i-fuel", txt:displayValue("fuel",c.fuel)},
    c.gearshift ? {ic:"i-gear", txt:displayValue("gear",c.gearshift)} : null,
    c.power ? {ic:"i-gauge", txt:`${Math.round(c.power*1.35962)} PS`} : null,
    c.seats ? {ic:"i-users", txt:c.seats} : null
  ].filter(x=>x&&x.txt);
  const subtitle = [c.trim_name || c.equipment_line || (c.config&&c.config.name) || c.engine, displayValue("body",c.cartype), c.model_year]
    .filter(Boolean).join(" · ");
  const pics = galleryPics(c);
  const logo = brandLogo(c);
  el.innerHTML = `
    <button class="card-open" data-open-car aria-label="${esc(openLabel)}"></button>
    <div class="cardbar">
      <div class="badges">
        ${c._isNew?`<span class="badge new" title="First seen by this tool on ${esc(fmtDateTime(c._firstSeen))}">new</span>`:""}
        ${c._drop>0?`<span class="badge drop" title="Base price dropped since your previous visit">▼ ${fmtEur(c._drop)}</span>`:""}
        ${label?`<span class="badge">${esc(label)}</span>`:""}
        ${c._soonView?'<span class="badge soon">coming soon</span>':""}
      </div>
      <div class="actions">
        <button class="sharebtn" data-share-key="${esc(key)}" title="Share this configuration" aria-label="Share this configuration"><svg class="ic" aria-hidden="true"><use href="#i-link"/></svg></button>
        <button class="favbtn ${state.favs.has(key)?"on":""}" data-fav="${esc(key)}" title="Favorite" aria-label="Toggle favorite" aria-pressed="${state.favs.has(key)}"><svg class="ic" aria-hidden="true"><use href="#i-heart"/></svg></button>
        <button class="cmpbtn ${state.compare.includes(key)?"on":""}" data-cmp="${esc(key)}" title="Add to compare" aria-label="Add to compare" aria-pressed="${state.compare.includes(key)}"><svg class="ic" aria-hidden="true"><use href="#i-compare"/></svg></button>
      </div>
    </div>
    <div class="imgwrap">
      <img class="hero" alt="${esc(carName(c))}" loading="lazy">
      ${state.cfg.largePalette?"":paletteHtml(c, 6, pics.length)}
      ${pics.length>1?`
        <button class="navarr prev" data-shot="-1" aria-label="Previous photo"><svg class="ic" aria-hidden="true"><use href="#i-left"/></svg></button>
        <button class="navarr next" data-shot="1" aria-label="Next photo"><svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></button>
        <div class="dots">${pics.slice(0,8).map((p,i)=>`<i class="${i===0?"on":""}"></i>`).join("")}</div>
        <span class="shots">1/${pics.length}</span>`:""}
    </div>
    <div class="cbody">
      ${state.cfg.largePalette?paletteHtml(c):""}
      <div class="chead">
        ${logo?`<img class="blogo" src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">`:""}
        <div class="txt">
          <div class="ctitle"><span class="bm">${esc(carName(c))}</span></div>
          <div class="ctrim">${esc(subtitle)}</div>
        </div>
        ${inventory==null?"":`<div class="card-stock" title="Customer-visible stock for this configuration; availability date still applies"><strong>${fmtNum(inventory)}</strong><span>${inventory===1?"car":"cars"}</span></div>`}
      </div>
      <div class="specrow">${specs.map(s=>`<span class="spec ${s.cls||""}"><svg class="ic" aria-hidden="true"><use href="#${s.ic}"/></svg><span>${esc(s.txt)}</span></span>`).join("")}</div>
      <div class="cfoot">
        <div class="price">
          <div class="from">from · ${fmtNum(state.cfg.km)} km/mo</div>
          <div class="val">${fmtEur(price)}<small> /month</small></div>
          <div class="incl">insurance · tax · maintenance incl.</div>
        </div>
        <div class="avail">
          ${av.txt==="available now"?'<span class="now">available now</span>':esc(av.txt)}
          <div class="terms" title="Contract terms across all colors of this version">${(()=>{const t=versionTermsList(c);return t.length?esc(t.join("/"))+" mo":"";})()}</div>
        </div>
      </div>
    </div>`;
  const img = el.querySelector("img.hero");
  img.addEventListener("load", ()=>{ img.classList.add("loaded"); normalizeHeroScale(img); });
  img.addEventListener("error", ()=>{ img.src = PLACEHOLDER; }, {once:true});
  img.src = pics.length ? pics[0] : PLACEHOLDER;
  el._pics = pics; el._shot = 0;
  return el;
}
/* de-duplicated photo URLs for a car, newest-first as delivered by the API */
/* brand logo — the API nests it as an object ({url,…}), older shapes used a plain string */
function brandLogo(c){
  const b = c.brand || {};
  const raw = b.helper_brand_logo || b.picture || b.logo;
  const url = typeof raw === "string" ? raw : (raw && raw.url);
  return /^https?:\/\//i.test(url||"") ? url : null;
}
function galleryPics(c){
  const urls = [];
  const push = u => { if (u && !urls.includes(u)) urls.push(u); };
  push(c.picture && c.picture.url);
  (Array.isArray(c.pictures)?c.pictures:[]).forEach(p=>push(p&&p.url));
  return urls.slice(0,10);
}
/* step the photo carousel on a card without opening the detail view */
function stepShot(card, dir){
  const pics = card._pics || [];
  if (pics.length<2) return;
  card._shot = (card._shot + dir + pics.length) % pics.length;
  const img = card.querySelector("img.hero");
  img.src = pics[card._shot];
  card.querySelectorAll(".dots i").forEach((d,i)=>d.classList.toggle("on", i===card._shot));
  const shots = card.querySelector(".shots");
  if (shots) shots.textContent = `${card._shot+1}/${pics.length}`;
  // model cards rotate through colors — keep the palette ring in sync
  card.querySelectorAll(".cpal[data-pal-idx]").forEach((b,i)=>{
    const on = i===card._shot;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
  });
}
/* one-tap presets for the filters people reach for first */
function renderQuickBar(){
  const bar = $("#quickBar");
  if (!state.facets){ bar.innerHTML = ""; bar._coveredFilters = new Set(); return; }
  const f = state.f, F = state.facets;
  const val = (list, re) => (list.find(([v])=>re.test(v))||[])[0];
  const inList = (arr,v) => arr.includes(v);
  const flip = (arr,v) => { const n=arr.indexOf("!"+v); if(n>=0) arr.splice(n,1); const i=arr.indexOf(v); if(i>=0) arr.splice(i,1); else arr.push(v); };
  const items = [];
  const ev = val(F.fuels,/elek|electr/i);
  const auto = val(F.gears,/automat/i);
  if (ev)   items.push({ic:"i-bolt",  label:"Electric",   on:inList(f.fuels,ev),    covers:`fuel:${ev}`, go:()=>flip(f.fuels,ev)});
  if (auto) items.push({ic:"i-gear",  label:"Automatic",  on:inList(f.gears,auto),  covers:`gear:${auto}`, go:()=>flip(f.gears,auto)});
  items.push({ic:"i-car",      label:"Towbar (AHK)", on:f.hitch, covers:"hitch", go:()=>{f.hitch=!f.hitch;$("#fltHitch").checked=f.hitch;}});
  items.push({ic:"i-tag",      label:"under 300 €", on:f.priceMax===300, covers:"priceMax:300", go:()=>setPriceMax(f.priceMax===300?null:300)});
  items.push({ic:"i-calendar", label:"≤ 4 weeks",   on:f.soon, covers:"soon", go:()=>{f.soon=!f.soon;$("#fltNow").checked=f.soon;}});
  items.push({ic:"i-shield",   label:"Deals",       on:f.deals, covers:"deals", go:()=>{f.deals=!f.deals;$("#fltDeals").checked=f.deals;}});
  bar.innerHTML = items.map((x,i)=>
    `<button class="qf ${x.on?"on":""}" data-qf="${i}" aria-pressed="${x.on}"><svg class="ic" aria-hidden="true"><use href="#${x.ic}"/></svg>${esc(x.label)}</button>`).join("");
  bar._items = items;
  bar._coveredFilters = new Set(items.filter(x=>x.on&&x.covers).map(x=>x.covers));
}
function setPriceMax(v){
  state.f.priceMax = v;
  syncRangeControls();
}
function renderStats(pulse=true){
  const n = state.filtered.length;
  const modelMode = state.cfg.browseMode==="models";
  const cnt = $("#cnt");
  cnt.textContent = fmtNum(modelMode?state.modelGroups.length:n);
  if(pulse){ cnt.classList.remove("pulse"); void cnt.offsetWidth; cnt.classList.add("pulse"); }
  $("#cntSub").textContent = modelMode
    ? `${state.modelGroups.length===1?"model":"models"} · ${fmtNum(n)} matching versions`
    : (n===1 ? "configuration" : `configurations of ${fmtNum(state.cars.length)}`);
  if(!n){ $("#stats").innerHTML=""; return; }
  const prices = state.filtered.map(c=>minPrice(c)).filter(p=>p!=null);
  const evs = state.filtered.filter(isEV).length;
  const brands = new Set(state.filtered.map(brandName)).size;
  const stock = (()=>{
    const infos = state.filtered.map(versionStockInfo);
    const known = infos.filter(i=>i.total!=null);
    return { n: known.length ? known.reduce((s,i)=>s+i.total,0) : aggregateStock(state.filtered),
             partial: infos.some(i=>!i.known) };
  })();
  const cheapest = prices.length?Math.min(...prices):null;
  const drops = state.filtered.filter(c=>c._drop>0).length;
  $("#stats").innerHTML = [
    stock.n!=null?`<span class="statchip" title="Customer-visible stock across listed configurations and resolved color variants${stock.partial?" — some colors not yet fetched":""}; availability dates still apply">cars <b>${fmtNum(stock.n)}${stock.partial?"+":""}</b></span>`:"",
    cheapest!=null?`<span class="statchip">cheapest <b>${fmtEur(cheapest)}</b></span>`:"",
    `<span class="statchip">EV share <b>${n?Math.round(evs/n*100):0}%</b></span>`,
    `<span class="statchip">brands <b>${brands}</b></span>`,
    drops?`<span class="statchip">▼ price drops <b>${drops}</b></span>`:"",
    (()=>{ const news = state.filtered.filter(c=>c._isNew).length;
           return news?`<span class="statchip">new <b>${news}</b></span>`:""; })(),
    (()=>{ const cs = state.filtered.filter(c=>c._soonView).length;
           return cs?`<span class="statchip">coming soon <b>${cs}</b></span>`:""; })()
  ].join("");
}
/* Called by the background stock crawler as sibling stocks resolve — refreshes
   the stats chip and patches visible model cards without re-rendering the grid. */
function updateStockDisplays(){
  renderStats(false);
  if (state.cfg.browseMode!=="models") return;
  refreshDisplayItems();
  for (const g of state.modelGroups){
    const el = document.querySelector(`.model-card[data-group="${CSS.escape(g.key)}"] .card-stock`);
    if (!el || g.stockCount==null) continue;
    const strong = el.querySelector("strong"), word = el.querySelector("span");
    if (strong) strong.textContent = `${fmtNum(g.stockCount)}${g.stockPartial?"+":""}`;
    if (word) word.textContent = g.stockCount===1&&!g.stockPartial ? "car" : "cars";
  }
}
function renderActiveFilters(){
  const f = state.f, out = [];
  renderQuickBar();
  const add = (key, label, undo) => out.push({key, label, undo});
  const tag = v => isNeg(v) ? "not "+v.slice(1) : v;
  if (f.q) add("query", `"${f.q}"`, ()=>{f.q="";$("#q").value="";});
  f.fuels.forEach(v=>add(`fuel:${v}`, facetTag("fuel",v), ()=>f.fuels=f.fuels.filter(x=>x!==v)));
  f.brands.forEach(v=>add(`brand:${v}`, tag(v), ()=>f.brands=f.brands.filter(x=>x!==v)));
  f.types.forEach(v=>add(`type:${v}`, facetTag("body",v), ()=>f.types=f.types.filter(x=>x!==v)));
  f.gears.forEach(v=>add(`gear:${v}`, facetTag("gear",v), ()=>f.gears=f.gears.filter(x=>x!==v)));
  const rangePill = (key, arr, unit, clear) => {
    if (!arr.length) return;
    const v = arr.map(Number).filter(Number.isFinite);
    const lbl = Math.min(...v)===Math.max(...v) ? `${v[0]} ${unit}` : `${Math.min(...v)}–${Math.max(...v)} ${unit}`;
    add(key, lbl, ()=>{clear();syncRangeControls();});
  };
  rangePill("terms", f.terms, "mo", ()=>f.terms=[]);
  rangePill("seats", f.seats, "seats", ()=>f.seats=[]);
  rangePill("doors", f.doors, "doors", ()=>f.doors=[]);
  f.colors.forEach(v=>add(`color:${v}`, tag(v), ()=>f.colors=f.colors.filter(x=>x!==v)));
  if (f.priceMin!=null) add(`priceMin:${f.priceMin}`, "≥ "+fmtEur(f.priceMin), ()=>{f.priceMin=null;syncRangeControls();});
  if (f.priceMax!=null) add(`priceMax:${f.priceMax}`, "≤ "+fmtEur(f.priceMax), ()=>{f.priceMax=null;syncRangeControls();});
  if (f.powerMin>0) add(`powerMin:${f.powerMin}`, `≥ ${f.powerMin} kW`, ()=>{f.powerMin=0;syncRangeControls();});
  if (f.powerMax!=null) add(`powerMax:${f.powerMax}`, `≤ ${f.powerMax} kW`, ()=>{f.powerMax=null;syncRangeControls();});
  if (f.rangeMin>0) add(`rangeMin:${f.rangeMin}`, `≥ ${f.rangeMin} km`, ()=>{f.rangeMin=0;$("#rangeSlider").value=0;});
  if (f.deals) add("deals", "deals", ()=>{f.deals=false;$("#fltDeals").checked=false;});
  if (f.hitch) add("hitch", "towbar", ()=>{f.hitch=false;$("#fltHitch").checked=false;});
  if (f.soon) add("soon", "≤ 4 weeks", ()=>{f.soon=false;$("#fltNow").checked=false;});
  if (f.realPics) add("realPics", "real photos", ()=>{f.realPics=false;$("#fltRealPics").checked=false;});
  if (f.drops) add("drops", "▼ price drops", ()=>{f.drops=false;$("#fltDrops").checked=false;});
  if (f.favOnly) add("favorites", "favorites", ()=>{f.favOnly=false;renderFavCount();});
  const covered = $("#quickBar")._coveredFilters || new Set();
  const visible = out.filter(x=>!covered.has(x.key));
  $("#activeFilters").innerHTML = visible.map((x,i)=>`<span class="af">${esc(x.label)}<button data-af="${i}" aria-label="Remove ${esc(x.label)} filter">✕</button></span>`).join("");
  $$("#activeFilters [data-af]").forEach(btn=>btn.addEventListener("click", e=>{
    e.stopPropagation(); visible[Number(btn.dataset.af)].undo(); syncChipStates(); apply();
  }));
  $("#fabCount").textContent = out.length;
  $("#filterCount").textContent = out.length;
  $("#filterCount").title = out.length ? `${out.length} active ${out.length===1?"filter":"filters"}` : "No active filters";
}
function syncChipStates(){
  const f=state.f;
  const groups = [["#fuelChips",f.fuels],["#typeChips",f.types],["#gearChips",f.gears],
                  ["#colorSwatches",f.colors]];
  for(const [sel,arr] of groups)
    $$(sel+" [data-chip]").forEach(ch=>{
      ch.classList.toggle("on", arr.includes(ch.dataset.chip));
      ch.classList.toggle("ex", arr.includes("!"+ch.dataset.chip));
    });
  $$("#brandList [data-brand]").forEach(cb=>{
    cb.checked = f.brands.includes(cb.dataset.brand);
    cb.indeterminate = f.brands.includes("!"+cb.dataset.brand);
    cb.closest(".checkrow").classList.toggle("ex", f.brands.includes("!"+cb.dataset.brand));
  });
  updateRangeOuts();
}
function resetFilters(){
  state.f = freshFilters();
  $("#q").value=""; $("#priceMin").value=""; $("#priceMax").value="";
  $("#rangeSlider").value=0;
  ["fltDeals","fltHitch","fltNow","fltRealPics","fltDrops"].forEach(id=>{$("#"+id).checked=false;});
  renderFavCount();
  syncRangeControls();
  syncChipStates(); apply();
}

/* ---------------- favorites ---------------- */
function toggleFav(key){
  if (state.favs.has(key)) state.favs.delete(key); else state.favs.add(key);
  saveFavs();
  $$(`[data-fav="${CSS.escape(key)}"]`).forEach(b=>{
    b.classList.toggle("on", state.favs.has(key));
    b.setAttribute("aria-pressed", String(state.favs.has(key)));
  });
  renderFavCount();
  if (state.f.favOnly){
    const versionsOpen = $("#versionsDlg").open;
    apply();
    if(versionsOpen){
      const group = findModelGroup(state.activeGroupKey);
      if(group) openVersions(group);
      else{ $("#versionsDlg").close(); toast("That model has no remaining favorites"); }
    }
  }
}
function renderFavCount(){
  $("#favCount").textContent = state.favs.size;
  $("#favToggle").classList.toggle("on", state.f.favOnly);
  $("#favToggle").setAttribute("aria-pressed", String(state.f.favOnly));
}

/* ---------------- detail dialog ---------------- */
function openDetail(c, options={}){
  if(options.list){ state.detailList = options.list; state.detailGroupKey = options.groupKey||null; }
  else if(!options.keepContext){ state.detailList = state.filtered; state.detailGroupKey = null; }
  const detailList = state.detailList || state.filtered;
  state.detailKey = carKey(c);
  const foundDetailIdx = detailList.findIndex(x=>carKey(x)===state.detailKey);
  // Color-variant switches keep the original list position as an anchor so
  // prev/next navigation keeps working from where the user was.
  state.detailIdx = foundDetailIdx>=0 ? foundDetailIdx : (options.keepContext && state.detailIdx>=0 ? state.detailIdx : -1);
  const dlg = $("#detailDlg");
  dlg.setAttribute("aria-label", `${carName(c)} ${c.trim_name||""} details`.trim());
  const pics0 = galleryPics(c).map(url=>({url}));
  let pics = pics0;
  const link = finnLink(c);
  const eq = c.equipment||{};
  const delim = c.equipment_delimiter || ";";
  const equipmentGroups = buildEquipmentGroups(eq,delim,c);
  const equipmentCount = equipmentGroups.reduce((sum,g)=>sum+g.items.length,0);
  const packages = (c.equipment_packages && typeof c.equipment_packages==="object" && !Array.isArray(c.equipment_packages))
    ? Object.entries(c.equipment_packages).filter(([name])=>name).slice(0,12) : [];
  const kv = [
    ["Fuel", displayValue("fuel",c.fuel)], ["Body", displayValue("body",c.cartype)], ["Gearshift", displayValue("gear",c.gearshift)],
    ["Power", c.power?`${c.power} kW / ${Math.round(c.power*1.35962)} PS`:null],
    ["Drive", displayValue("drive",c.config_drive)], ["Engine", c.engine],
    ["EV range", evRange(c)?fmtNum(evRange(c))+" km":null],
    ["Consumption", c.consumption?c.consumption+(isEV(c)?" kWh/100km":" l/100km"):null],
    ["CO₂", c.co2emission!=null?fmtNum(c.co2emission)+" g/km":null],
    ["Efficiency", c.efficiency_class || c.co2_class],
    ["Seats", c.seats], ["Doors", c.doors],
    ["Model year", c.model_year],
    ["Tires", [c.tires?(({all_season:"All-season",summer_winter:"Summer / winter",summer:"Summer",winter:"Winter"})[c.tires]||String(c.tires).replace(/_/g," ")):null, c.tire_size_inches?`${c.tire_size_inches}″`:null].filter(Boolean).join(" · ")||null],
    ["Color", c.color&&c.color.specific],
    ["Interior", c.interior_color&&c.interior_color.specific],
    ["MSRP", c.price&&c.price.msrp?fmtEur(c.price.msrp):null]
  ].filter(([,v])=>v!=null&&v!=="");
  const inventory = stockCount(c);
  const av = availLabel(c);
  const inList = state.detailIdx >= 0;
  const favOn = state.favs.has(carKey(c));
  const logo = brandLogo(c);
  const kmp = kmPackages(c);
  const kmChoices = kmp.length ? kmp : [{km:state.cfg.km||500,fee:0}];
  const requestedKm = options.keepContext ? state.detailQuoteKm : state.cfg.km;
  const quoteKmOption = kmChoices.find(x=>x.km===requestedKm) || kmChoices.filter(x=>x.km<=requestedKm).at(-1) || kmChoices[0];
  let quoteKm = quoteKmOption.km;
  let quotePrices = priceList(c,quoteKm);
  const cheapestQuote = quotePrices.length ? quotePrices.reduce((best,x)=>x.price<best.price?x:best,quotePrices[0]) : null;
  const requestedTerm = options.keepContext ? state.detailQuoteTerm : null;
  let quoteTerm = quotePrices.some(x=>x.term===requestedTerm) ? requestedTerm : (cheapestQuote&&cheapestQuote.term);
  state.detailQuoteKm=quoteKm; state.detailQuoteTerm=quoteTerm;
  const advertisedPrice = minPrice(c);
  const quoteRows = (list,selectedTerm) => {
    const cheapest = list.length ? Math.min(...list.map(x=>x.price)) : null;
    return list.map(x=>`<tr class="${[x.price===cheapest?"best":"",x.term===selectedTerm?"selected":""].filter(Boolean).join(" ")}"><td>${x.term} months${x.price===cheapest?'<span class="best-tag">best price</span>':""}${x.term===selectedTerm?'<span class="selected-tag">selected</span>':""}</td><td class="num">${fmtEur2(x.price)}</td></tr>`).join("") || '<tr><td colspan="2">No price list returned.</td></tr>';
  };
  const initialQuote = quotePrices.find(x=>x.term===quoteTerm) || cheapestQuote;
  const initialDelta = initialQuote&&advertisedPrice!=null ? initialQuote.price-advertisedPrice : 0;
  const quoteDeltaText = delta => delta>0 ? `+${fmtEur(delta)} / month vs ${fmtEur(advertisedPrice)} starting price` : delta<0 ? `${fmtEur(Math.abs(delta))} less / month vs ${fmtEur(advertisedPrice)} starting price` : `Matches the ${fmtEur(advertisedPrice)} starting price`;
  const configPdf = configPdfLink(c);
  const colorList = Array.isArray(c.color_list) ? c.color_list.slice(0,12) : [];
  const colorVariants = colorList.map(cl=>{
    const uid = cl.uid!=null ? String(cl.uid) : null;
    const isSelf = uid!=null ? String(c.uid??carKey(c))===uid : (!!c.color&&c.color.specific===cl.color_specific);
    const catalogCar = !isSelf&&uid ? state.cars.find(x=>String(x.uid??"")===uid||carKey(x)===uid) : null;
    return {
      name: cl.color_specific||"Unnamed color", hex: cl.color_hex, date: cl.availability_date,
      uid,
      pics: (Array.isArray(cl.pictures)&&cl.pictures.length ? cl.pictures.map(p=>(p&&p.url)||p) : [cl.picture_front_url])
        .filter(u=>typeof u==="string"&&u),
      catalogCar, isSelf
    };
  });
  const highlights = [
    evRange(c)?{ic:"i-bolt",k:"EV range",v:fmtNum(evRange(c))+" km"}:{ic:"i-fuel",k:"Fuel",v:displayValue("fuel",c.fuel)},
    c.gearshift?{ic:"i-gear",k:"Gearshift",v:displayValue("gear",c.gearshift)}:null,
    c.power?{ic:"i-gauge",k:"Power",v:Math.round(c.power*1.35962)+" PS"}:null,
    c.seats?{ic:"i-users",k:"Seats",v:c.seats}:null
  ].filter(Boolean);
  dlg.innerHTML = `
    <div class="dhead detail-head">
      ${state.detailGroupKey?`<button class="ghost detail-back" data-back-versions><svg class="ic" aria-hidden="true"><use href="#i-left"/></svg> Versions</button>`:""}
      <div class="detail-head-main">
        ${logo?`<img class="blogo" src="${esc(logo)}" alt="" onerror="this.remove()">`:""}
        <div class="detail-heading">
          <div class="eyebrow">${esc(brandName(c))}${c.model_year?` · model year ${esc(c.model_year)}`:""}</div>
          <div class="t">${esc(c.model||carName(c))}${c.trim_name?` <span class="trim">${esc(c.trim_name)}</span>`:""}</div>
          <div class="s">${esc([c.engine,displayValue("drive",c.config_drive),c.color&&c.color.specific].filter(Boolean).join(" · ") || [displayValue("fuel",c.fuel),displayValue("body",c.cartype),displayValue("gear",c.gearshift)].filter(Boolean).join(" · "))}</div>
        </div>
      </div>
      <div class="dnav">
        ${inList?`<span class="dpos">${state.detailIdx+1} / ${fmtNum(detailList.length)}</span>
        <button class="iconbtn" id="dPrev" title="Previous vehicle (←)" aria-label="Previous vehicle" ${state.detailIdx<=0?"disabled":""}><svg class="ic" aria-hidden="true"><use href="#i-left"/></svg></button>
        <button class="iconbtn" id="dNext" title="Next vehicle (→)" aria-label="Next vehicle" ${state.detailIdx>=detailList.length-1?"disabled":""}><svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></button>`:""}
        <button class="iconbtn ${favOn?"on":""}" data-fav="${esc(carKey(c))}" title="Favorite (f)" aria-label="Toggle favorite" aria-pressed="${favOn}"><svg class="ic" aria-hidden="true"><use href="#i-heart"/></svg></button>
        <button class="iconbtn ${state.compare.includes(carKey(c))?"on":""}" data-cmp="${esc(carKey(c))}" title="Add to comparison" aria-label="Add to comparison" aria-pressed="${state.compare.includes(carKey(c))}"><svg class="ic" aria-hidden="true"><use href="#i-compare"/></svg></button>
        <button class="iconbtn" data-share-key="${esc(carKey(c))}" title="Share this configuration (current color included)" aria-label="Share this configuration"><svg class="ic" aria-hidden="true"><use href="#i-link"/></svg></button>
        <button class="iconbtn x" data-close="detailDlg" aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
    </div>
    <div class="dbody detail-body">
      <div class="detail-hero">
        <div class="gallery detail-gallery">
          <div class="main">
            <img id="galMain" alt="${esc(carName(c))}">
            <button class="navarr prev" data-gal-step="-1" aria-label="Previous photo (←)"><svg class="ic" aria-hidden="true"><use href="#i-left"/></svg></button>
            <button class="navarr next" data-gal-step="1" aria-label="Next photo (→)"><svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></button>
            <button class="navarr lb-open" data-lb-open aria-label="Open large gallery" title="Large view"><svg class="ic" aria-hidden="true"><use href="#i-expand"/></svg></button>
          </div>
          <div class="thumbs" data-gal-thumbs></div>
          ${colorVariants.length?`<div class="detail-colorbar" role="group" aria-label="Color variants">${colorVariants.map((v,i)=>`<button class="detail-color${v.isSelf?" on":""}" data-color-idx="${i}" title="${esc(v.name)}${v.date?` · available from ${esc(fmtDate(v.date))}`:""}${v.catalogCar?" · open this color":v.isSelf?"":v.pics.length?" · preview photos":""}" aria-pressed="${v.isSelf}"><span class="sw"${vehicleColorStyle(v.hex)}></span><span class="name">${esc(v.name)}</span><span class="date">${esc(fmtDate(v.date))}</span></button>`).join("")}</div>`:""}
        </div>
        <div class="detail-summary">
          <div class="detail-availability"><span>${av.txt==="available now"?'<span class="now">available now</span>':esc(av.txt)}</span>${inventory==null?'<span>Configure your subscription</span>':`<span class="detail-stock" title="Customer-visible stock for this configuration; availability date still applies"><svg class="ic" aria-hidden="true"><use href="#i-car"/></svg><strong>${fmtNum(inventory)}</strong> ${inventory===1?"car":"cars"}</span>`}</div>
          <div class="detail-configurator">
            <div class="quote-group"><div class="quote-head"><span>Monthly mileage</span><b data-quote-km-label>${fmtNum(quoteKm)} km/month</b></div><div class="quote-options" data-quote-kms role="group" aria-label="Monthly mileage">${kmChoices.map(x=>`<button class="quote-option ${x.km===quoteKm?"on":""}" data-quote-km="${x.km}" aria-pressed="${x.km===quoteKm}"><b>${fmtNum(x.km)} km</b><small>${x.fee?"+"+fmtEur(x.fee)+" / mo":"included"}</small></button>`).join("")}</div></div>
            <div class="quote-group"><div class="quote-head"><span>Contract length</span><b data-quote-term-label>${quoteTerm?quoteTerm+" months":"on request"}</b></div><div class="quote-options" data-quote-terms role="group" aria-label="Contract length">${quotePrices.map(x=>`<button class="quote-option ${x.term===quoteTerm?"on":""}" data-quote-term="${x.term}" aria-pressed="${x.term===quoteTerm}"><b>${x.term} months</b><small>${fmtEur(x.price)} / mo</small></button>`).join("") || '<span class="detail-price-note">No selectable terms available.</span>'}</div></div>
          </div>
          <div class="detail-price-block" aria-live="polite">
            <div class="overline" data-quote-context>${quoteTerm?quoteTerm+" months · ":""}${fmtNum(quoteKm)} km/month · ${state.cfg.biz?"business":"private"}</div>
            <div class="detail-price-value" data-quote-monthly>${fmtEur(initialQuote&&initialQuote.price)}<small> / month</small></div>
            <div class="quote-change ${initialDelta>0?"up":initialDelta<0?"down":"same"}" data-quote-delta>${quoteDeltaText(initialDelta)}</div>
            <div class="quote-total" title="Monthly price multiplied by contract length"><span data-quote-total-label>Contract total · ${quoteTerm||"–"} months</span><strong data-quote-total>${initialQuote&&quoteTerm?fmtEur(initialQuote.price*quoteTerm):"–"}</strong></div>
          </div>
          <div class="detail-highlights">${highlights.map(x=>`<div class="detail-highlight"><svg class="ic" aria-hidden="true"><use href="#${x.ic}"/></svg><div><div class="hk">${esc(x.k)}</div><div class="hv">${esc(x.v)}</div></div></div>`).join("")}</div>
          ${configPdf?`<div class="detail-document"><svg class="ic" aria-hidden="true"><use href="#i-file"/></svg><div><div class="doc-title">Configuration PDF</div><div class="doc-meta">Factory specification · PDF document</div></div><div class="doc-actions"><a class="doc-open" href="${esc(configPdf)}" target="_blank" rel="noreferrer" title="Open configuration PDF in a new tab">Open PDF <svg class="ic" aria-hidden="true"><use href="#i-link"/></svg></a><button class="doc-download" data-pdf-download title="Download configuration PDF" aria-label="Download configuration PDF"><svg class="ic" aria-hidden="true"><use href="#i-download"/></svg></button></div></div>`:""}
          <div class="detail-actions">
            ${link?`<a class="linkout" href="${esc(link)}" target="_blank" rel="noreferrer">View offer on finn.com <svg class="ic" aria-hidden="true"><use href="#i-right"/></svg></a>`:'<span></span>'}
          </div>
        </div>
      </div>
      <div class="detail-content-grid">
        <section class="detail-panel">
          <div class="detail-panel-head"><div><h3>Technical details</h3><p>Everything important at a glance</p></div></div>
          <div class="kv detail-kv">${kv.map(([k,v])=>`<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
        </section>
        <section class="detail-panel">
          <div class="detail-panel-head"><div><h3>Monthly pricing</h3><p>${state.cfg.biz?"Business":"Private"} · <span data-quote-panel-km>${fmtNum(quoteKm)} km/month</span></p></div>${c._drop>0?`<span class="badge drop">▼ ${fmtEur(c._drop)}</span>`:""}</div>
          <div class="detail-price-table"><table class="ptable"><thead><tr><th>Term</th><th>per month</th></tr></thead><tbody data-quote-table>${quoteRows(quotePrices,quoteTerm)}</tbody></table></div>
          <div class="detail-km-note" data-quote-km-note>${kmFeeFor(c,quoteKm)?`The ${fmtNum(quoteKm)} km package adds <b>${fmtEur(kmFeeFor(c,quoteKm))} / month</b> to every term.`:`The ${fmtNum(quoteKm)} km package is included in the base monthly price.`}</div>
        </section>
      </div>
      <section class="detail-panel eq">
        <div class="detail-panel-head"><div><h3>Equipment</h3><p>${equipmentCount?`${fmtNum(equipmentCount)} included features · grouped by category`:"Equipment supplied by the vehicle API"}</p></div></div>
        ${packages.length?`<div class="equipment-packages">${packages.map(([name,items])=>`<div class="equipment-package"><div class="pkg-head"><svg class="ic" aria-hidden="true"><use href="#i-tag"/></svg><b>${esc(name)}</b><span class="pkg-tag">package</span></div>${items?`<p>${esc(items)}</p>`:""}</div>`).join("")}</div>`:""}
        <div class="detail-equipment">${equipmentGroups.length?equipmentGroups.map((g,i)=>`<section class="equipment-panel" aria-labelledby="eqHeading${i}"><div class="equipment-panel-head"><svg class="ic" aria-hidden="true"><use href="#${g.icon}"/></svg><div><h4 class="title" id="eqHeading${i}">${esc(g.title)}</h4><p>${esc(g.description)}</p></div><span class="count">${g.items.length} included</span></div><ul class="equipment-list">${[...g.items].sort((a,b)=>String(a).length-String(b).length).map(item=>`<li>${esc(item)}</li>`).join("")}</ul></section>`).join(""):'<div class="detail-price-note">No equipment details provided by the API.</div>'}</div>
      </section>
      <div class="detail-meta">config ${esc(c.config_id)} · ${esc(c.id||"no product id")}${c._firstSeen?` · first seen ${esc(fmtDateTime(c._firstSeen))}`:""}</div>
    </div>`;
  const main = dlg.querySelector("#galMain");
  let galIdx = 0;
  const setMain = i => {
    galIdx = pics.length ? ((i % pics.length) + pics.length) % pics.length : 0;
    main.src = pics[galIdx] && pics[galIdx].url ? pics[galIdx].url : PLACEHOLDER;
    dlg.querySelectorAll("[data-gal]").forEach((t,idx)=>t.classList.toggle("on", idx===galIdx));
  };
  main.addEventListener("error", ()=>{ main.src=PLACEHOLDER; }, {once:true});
  main.addEventListener("load", ()=>normalizeHeroScale(main, "detail"));
  const openGalleryLightbox = () => openLightbox(pics, galIdx, carName(c), i=>setMain(i));
  main.style.cursor = "zoom-in";
  main.addEventListener("click", openGalleryLightbox);
  dlg.querySelector("[data-lb-open]").addEventListener("click", e=>{ e.stopPropagation(); openGalleryLightbox(); });
  const galStep = dir => {
    if (pics.length < 2) return false;
    setMain(galIdx + dir);
    return true;
  };
  dlg._galStep = galStep;
  dlg._shareCc = null;
  dlg.querySelectorAll("[data-gal-step]").forEach(btn=>btn.addEventListener("click", e=>{ e.stopPropagation(); galStep(Number(btn.dataset.galStep)); }));
  const renderGallery = () => {
    const wrap = dlg.querySelector("[data-gal-thumbs]");
    wrap.innerHTML = pics.length>1 ? pics.map((p,i)=>`<img data-gal="${i}" alt="${esc(carName(c))} view ${i+1}">`).join("") : "";
    wrap.querySelectorAll("[data-gal]").forEach(t=>{
      t.src = pics[Number(t.dataset.gal)].url;
      t.addEventListener("error", ()=>{ t.src=PLACEHOLDER; }, {once:true});
      t.addEventListener("click", ()=>setMain(Number(t.dataset.gal)));
    });
    dlg.querySelectorAll("[data-gal-step]").forEach(btn=>{ btn.hidden = pics.length<2; });
    setMain(0);
  };
  renderGallery();
  dlg.querySelectorAll("[data-color-idx]").forEach(b=>b.addEventListener("click", ()=>{
    const v = colorVariants[Number(b.dataset.colorIdx)];
    if (!v || b.getAttribute("aria-busy")==="true") return;
    if (v.isSelf){
      pics = pics0; renderGallery();
      setDetailPreview(false);
      dlg._shareCc = null;
      dlg.querySelectorAll("[data-color-idx]").forEach(x=>{ x.classList.toggle("on", x===b); x.setAttribute("aria-pressed", String(x===b)); });
      return;
    }
    // A sibling config in the catalog carries the real data — switch to it.
    if (v.catalogCar){ openDetail(v.catalogCar, {keepContext:true}); return; }
    if (v.uid){
      const openedKey = carKey(c);
      b.setAttribute("aria-busy","true");
      fetchConfigByUid(v.uid).then(car=>{
        b.removeAttribute("aria-busy");
        if (!dlg.open || state.detailKey!==openedKey) return;   // dialog moved on meanwhile
        if (car){ openDetail(car, {keepContext:true}); return; }
        if (applyVariantPics(v, b)) setDetailPreview(true, v);
      });
      return;
    }
    if (applyVariantPics(v, b)) setDetailPreview(true, v);
  }));
  function applyVariantPics(v, b){
    if (!v.pics.length){ toast(`${v.name} isn't listed by the API yet${v.date?` — expected from ${fmtDate(v.date)}`:""}`); return false; }
    pics = v.pics.map(url=>({url}));
    renderGallery();
    dlg._shareCc = v.uid || null;
    dlg.querySelectorAll("[data-color-idx]").forEach(x=>{ x.classList.toggle("on", x===b); x.setAttribute("aria-pressed", String(x===b)); });
    return true;
  }
  /* Selected color has no published pricing yet: dim the figures and explain
     that they still belong to the listed color. */
  function setDetailPreview(on, v){
    const summary = dlg.querySelector(".detail-summary");
    if (!summary) return;
    summary.classList.toggle("is-preview", on);
    let note = summary.querySelector(".preview-note");
    if (on){
      if (!note){ note = document.createElement("div"); note.className = "preview-note"; summary.prepend(note); }
      const baseName = (c.color && c.color.specific) || "the listed color";
      note.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-help"/></svg><span><b>${esc(v.name)}</b> isn't bookable yet${v.date?` — expected from <b>${esc(fmtDate(v.date))}</b>`:""}. The figures below still show <b>${esc(baseName)}</b>.</span>`;
    } else if (note) note.remove();
  }
  // Each color is its own config with its own stock — resolve counts lazily
  // (from the catalog when listed, otherwise via a cached config_id lookup).
  const setChipStock = (i,n) => {
    const btn = dlg.querySelector(`[data-color-idx="${i}"]`);
    if (!btn) return;
    let s = btn.querySelector(".stock");
    if (!s){ s = document.createElement("span"); s.className = "stock"; btn.appendChild(s); }
    if (n==null){
      s.textContent = "–"; s.classList.add("none");
      s.title = "Not listed by the API yet — no stock to show";
    } else {
      s.textContent = `${fmtNum(n)} ${n===1?"car":"cars"}`; s.classList.remove("none");
      s.title = "Customer-visible stock for this color";
    }
  };
  const stockOpenKey = carKey(c);
  colorVariants.forEach((v,i)=>{
    if (v.isSelf){ setChipStock(i, stockCount(c)); return; }
    const source = v.catalogCar ? Promise.resolve(v.catalogCar) : (v.uid ? fetchConfigByUid(v.uid) : Promise.resolve(null));
    source.then(car=>{
      if (!dlg.open || state.detailKey!==stockOpenKey) return;
      setChipStock(i, car ? stockCount(car) : null);
    });
  });
  if (options.colorUid){
    const wantedIdx = colorVariants.findIndex(v=>v.uid===String(options.colorUid));
    const wanted = wantedIdx>=0 ? colorVariants[wantedIdx] : null;
    if (wanted && !wanted.isSelf){
      const btn = dlg.querySelector(`[data-color-idx="${wantedIdx}"]`);
      if (btn) btn.click();
    }
  }
  const updateDetailQuote = () => {
    quotePrices = priceList(c,quoteKm);
    if(!quotePrices.some(x=>x.term===quoteTerm)){
      const cheapest = quotePrices.length ? quotePrices.reduce((best,x)=>x.price<best.price?x:best,quotePrices[0]) : null;
      quoteTerm = cheapest&&cheapest.term;
    }
    const selected = quotePrices.find(x=>x.term===quoteTerm);
    const delta = selected&&advertisedPrice!=null ? selected.price-advertisedPrice : 0;
    state.detailQuoteKm=quoteKm; state.detailQuoteTerm=quoteTerm;
    dlg.querySelector("[data-quote-km-label]").textContent=`${fmtNum(quoteKm)} km/month`;
    dlg.querySelector("[data-quote-term-label]").textContent=quoteTerm?`${quoteTerm} months`:"on request";
    dlg.querySelector("[data-quote-context]").textContent=`${quoteTerm?quoteTerm+" months · ":""}${fmtNum(quoteKm)} km/month · ${state.cfg.biz?"business":"private"}`;
    dlg.querySelector("[data-quote-monthly]").innerHTML=`${fmtEur(selected&&selected.price)}<small> / month</small>`;
    const change=dlg.querySelector("[data-quote-delta]");
    change.className=`quote-change ${delta>0?"up":delta<0?"down":"same"}`; change.textContent=quoteDeltaText(delta);
    dlg.querySelector("[data-quote-total-label]").textContent=`Contract total · ${quoteTerm||"–"} months`;
    dlg.querySelector("[data-quote-total]").textContent=selected&&quoteTerm?fmtEur(selected.price*quoteTerm):"–";
    dlg.querySelector("[data-quote-panel-km]").textContent=`${fmtNum(quoteKm)} km/month`;
    dlg.querySelector("[data-quote-table]").innerHTML=quoteRows(quotePrices,quoteTerm);
    const fee=kmFeeFor(c,quoteKm);
    dlg.querySelector("[data-quote-km-note]").innerHTML=fee?`The ${fmtNum(quoteKm)} km package adds <b>${fmtEur(fee)} / month</b> to every term.`:`The ${fmtNum(quoteKm)} km package is included in the base monthly price.`;
    dlg.querySelectorAll("[data-quote-km]").forEach(b=>{const on=Number(b.dataset.quoteKm)===quoteKm;b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));});
    dlg.querySelectorAll("[data-quote-term]").forEach(b=>{const term=Number(b.dataset.quoteTerm),on=term===quoteTerm,entry=quotePrices.find(x=>x.term===term);b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));const small=b.querySelector("small");if(small)small.textContent=entry?`${fmtEur(entry.price)} / mo`:"unavailable";});
    const block=dlg.querySelector(".detail-price-block");
    block.classList.remove("quote-pulse"); requestAnimationFrame(()=>block.classList.add("quote-pulse"));
  };
  dlg.querySelectorAll("[data-quote-km]").forEach(b=>b.addEventListener("click",()=>{quoteKm=Number(b.dataset.quoteKm);updateDetailQuote();}));
  dlg.querySelectorAll("[data-quote-term]").forEach(b=>b.addEventListener("click",()=>{quoteTerm=Number(b.dataset.quoteTerm);updateDetailQuote();}));
  const pdfDownload = dlg.querySelector("[data-pdf-download]");
  if(pdfDownload) pdfDownload.addEventListener("click",()=>downloadConfigPdf(c,pdfDownload));
  const prev = dlg.querySelector("#dPrev"), next = dlg.querySelector("#dNext");
  if (prev) prev.addEventListener("click", e=>{ e.stopPropagation(); stepDetail(-1); });
  if (next) next.addEventListener("click", e=>{ e.stopPropagation(); stepDetail(1); });
  const back = dlg.querySelector("[data-back-versions]");
  if(back) back.addEventListener("click",()=>{ const group=findModelGroup(state.detailGroupKey); dlg.close(); openVersions(group); });
  if (!dlg.open) dlg.showModal();
  dlg.querySelector(".dbody").scrollTop = 0;
}
function stepDetail(dir){
  if (state.detailIdx < 0) return;
  const detailList = state.detailList || state.filtered;
  const i = state.detailIdx + dir;
  if (i < 0 || i >= detailList.length) return;
  openDetail(detailList[i],{keepContext:true});
}

/* ---------------- compare ---------------- */
function toggleCompare(key){
  const i = state.compare.indexOf(key);
  if (i>=0) state.compare.splice(i,1);
  else{
    if (state.compare.length>=3) state.compare.shift();
    state.compare.push(key);
  }
  $$(".cmpbtn").forEach(b=>{
    b.classList.toggle("on", state.compare.includes(b.dataset.cmp));
    b.setAttribute("aria-pressed", String(state.compare.includes(b.dataset.cmp)));
  });
  renderCmpBar();
}
function renderCmpBar(){
  const bar = $("#cmpBar");
  const cars = state.compare.map(k=>state.cars.find(c=>carKey(c)===k)).filter(Boolean);
  if(!cars.length){ bar.classList.remove("show"); document.body.classList.remove("cmp-open"); return; }
  $("#cmpThumbs").innerHTML = cars.map(c=>`<img alt="${esc(carName(c))}" title="${esc(carName(c))}">`).join("");
  Array.from($("#cmpThumbs").children).forEach((img,i)=>{
    img.src = pictureUrl(cars[i])||PLACEHOLDER;
    img.addEventListener("error", ()=>{img.src=PLACEHOLDER;}, {once:true});
  });
  $("#cmpGo").textContent = `Compare (${cars.length})`;
  bar.classList.add("show");
  document.body.classList.add("cmp-open");
}
function openCompare(){
  const cars = state.compare.map(k=>state.cars.find(c=>carKey(c)===k)).filter(Boolean);
  if (cars.length<2) return;
  const dlg = $("#cmpDlg");
  const row = (label, fn, cls) => `<tr><th>${esc(label)}</th>${cars.map(c=>`<td class="${cls||""}">${fn(c)??"–"}</td>`).join("")}</tr>`;
  dlg.innerHTML = `
    <div class="dhead"><div class="t">Compare ${cars.length} vehicles</div><button class="iconbtn x" data-close="cmpDlg" aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button></div>
    <div class="dbody">
      <table class="cmp">
        <thead><tr><th></th>${cars.map(c=>`<td><img alt="${esc(carName(c))}"><br>${esc(carName(c))}<br><span class="cmp-trim">${esc(c.trim_name||"")}</span></td>`).join("")}</tr></thead>
        <tbody>
          ${row("from / month", c=>fmtEur(minPrice(c)))}
          ${row("terms", c=>Array.isArray(c.available_terms)?esc(c.available_terms.join(" / "))+" mo":"–")}
          ${row("fuel", c=>esc(displayValue("fuel",c.fuel)))}
          ${row("body", c=>esc(displayValue("body",c.cartype)))}
          ${row("gearshift", c=>esc(displayValue("gear",c.gearshift)))}
          ${row("power", c=>c.power?`${c.power} kW (${Math.round(c.power*1.35962)} PS)`:"–")}
          ${row("EV range", c=>evRange(c)?fmtNum(evRange(c))+" km":"–")}
          ${row("consumption", c=>c.consumption?esc(c.consumption)+(isEV(c)?" kWh":" l")+"/100km":"–")}
          ${row("CO₂", c=>c.co2emission!=null?fmtNum(c.co2emission)+" g/km":"–")}
          ${row("seats / doors", c=>`${esc(c.seats||"–")} / ${esc(c.doors||"–")}`)}
          ${row("available", c=>esc(availLabel(c).txt))}
          ${row("extra km", c=>{
            const kp = kmPackages(c).filter(x=>x.fee>0);
            if (kp.length) return "+"+fmtNum(kp[0].km)+" km: "+fmtEur(kp[0].fee)+"/mo";
            return c.price&&c.price.extra_km_price?fmtEur2(c.price.extra_km_price)+"/km":"–";
          })}
          ${row("MSRP", c=>c.price&&c.price.msrp?fmtEur(c.price.msrp):"–")}
        </tbody>
      </table>
    </div>`;
  const imgs = dlg.querySelectorAll("thead img");
  imgs.forEach((img,i)=>{ img.src = pictureUrl(cars[i])||PLACEHOLDER; img.addEventListener("error",()=>{img.src=PLACEHOLDER;},{once:true}); });
  dlg.showModal();
}

/* ---------------- CSV export ---------------- */
function exportCsv(){
  const terms = state.f.terms.map(Number);
  const rows = [["brand","model","trim","fuel","body","gearshift","power_kw","ev_range_km","seats","doors","price_from_eur","terms_months","available_from","favorite","finn_link"]];
  for(const c of state.filtered){
    rows.push([brandName(c), c.model||"", c.trim_name||"", c.fuel||"", c.cartype||"", c.gearshift||"",
      c.power??"", evRange(c)??"", c.seats||"", c.doors||"",
      minPrice(c, terms.length?terms:null)??"",
      Array.isArray(c.available_terms)?c.available_terms.join("/"):"",
      c.available_from||"", state.favs.has(carKey(c))?"yes":"", finnLink(c)||""]);
  }
  const csv = "﻿" + rows.map(r=>r.map(v=>{
    const s=String(v).replace(/"/g,'""');
    return /[;"\n]/.test(s)?`"${s}"`:s;
  }).join(";")).join("\r\n");
  const a = document.createElement("a");
  const objectUrl=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.href = objectUrl;
  a.download = "finn-vnext-export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(objectUrl),5000);
  toast(`${fmtNum(state.filtered.length)} configurations exported as CSV`);
}

/* ---------------- toast & shareable URL state ---------------- */
let toastT;
function toast(msg){
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(()=>el.classList.remove("show"), 2200);
}
/* Filters live in the URL hash -> every view is bookmarkable & shareable. */
function writeHash(){
  const h=FinnDomain.encodeViewState({filters:state.f,km:state.cfg.km,browseMode:state.cfg.browseMode,sort:state.sort});
  history.replaceState(null, "", h ? "#"+h : location.pathname + location.search);
}
function readHash(){
  try{
    const decoded=FinnDomain.decodeViewState(location.hash);
    state.f=decoded.filters;
    if(decoded.browseMode) state.cfg.browseMode=decoded.browseMode;
    if(decoded.km) state.cfg.km=decoded.km;
    if(decoded.sort) state.sort=decoded.sort;
    return decoded.hasState;
  }catch(e){ return false; }
}
/* Minimal dual-thumb range slider built from two stacked native inputs.
   opts.values snaps to a discrete list (used for contract terms). */
function initDualRange(el, opts){
  const values = opts.values || null;
  const min = values ? 0 : opts.min, max = values ? values.length-1 : opts.max, step = values ? 1 : (opts.step||1);
  el.innerHTML = `<div class="dr-rail"></div><div class="dr-fill"></div>
    <input type="range" class="dr-lo" aria-label="${esc(opts.labelLo||"Minimum")}">
    <input type="range" class="dr-hi" aria-label="${esc(opts.labelHi||"Maximum")}">`;
  const lo = el.querySelector(".dr-lo"), hi = el.querySelector(".dr-hi"), fill = el.querySelector(".dr-fill");
  lo.min = hi.min = min; lo.max = hi.max = max; lo.step = hi.step = step;
  lo.value = min; hi.value = max;
  const paint = () => {
    const a = Number(lo.value), b = Number(hi.value), span = Math.max(1, max-min);
    fill.style.insetInlineStart = ((a-min)/span*100)+"%";
    fill.style.inlineSize = ((b-a)/span*100)+"%";
    // keep the reachable thumb on top when both sit at an extreme
    lo.style.zIndex = a > min + span/2 ? 4 : 2;
  };
  const emit = () => opts.onInput(values ? values[Number(lo.value)] : Number(lo.value),
                                  values ? values[Number(hi.value)] : Number(hi.value),
                                  Number(lo.value)<=min, Number(hi.value)>=max);
  lo.addEventListener("input", ()=>{ if(Number(lo.value)>Number(hi.value)) lo.value = hi.value; paint(); emit(); });
  hi.addEventListener("input", ()=>{ if(Number(hi.value)<Number(lo.value)) hi.value = lo.value; paint(); emit(); });
  el._dr = {
    set(a, b){ // raw values (or snap-list values); null = full bound
      const idx = v => values ? Math.max(0, values.indexOf(v)) : v;
      lo.value = a==null ? min : Math.max(min, Math.min(max, idx(a)));
      hi.value = b==null ? max : (values ? (values.indexOf(b)>=0?values.indexOf(b):max) : Math.max(min, Math.min(max, b)));
      if(Number(lo.value)>Number(hi.value)) lo.value = hi.value;
      paint();
    },
    setBounds(newMin, newMax){ if(values) return; lo.min = hi.min = newMin; lo.max = hi.max = newMax; paint(); },
  };
  paint();
  return el;
}
/* Push state.f into all range widgets + readouts (single source of truth). */
function syncRangeControls(){
  const f = state.f, F = state.facets;
  const price = $("#priceRange"), power = $("#powerRange"), term = $("#termRange");
  if (price && price._dr) price._dr.set(f.priceMin, f.priceMax);
  if (power && power._dr) power._dr.set(f.powerMin>0?f.powerMin:null, f.powerMax);
  if (term && term._dr && F){
    const sel = f.terms.map(Number).filter(t=>F.terms.includes(t));
    term._dr.set(sel.length?Math.min(...sel):null, sel.length?Math.max(...sel):null);
  }
  const seatR = $("#seatRange"), doorR = $("#doorRange");
  if (seatR && seatR._dr){
    const sel = f.seats.map(Number).filter(Number.isFinite);
    seatR._dr.set(sel.length?Math.min(...sel):null, sel.length?Math.max(...sel):null);
  }
  if (doorR && doorR._dr){
    const sel = f.doors.map(Number).filter(Number.isFinite);
    doorR._dr.set(sel.length?Math.min(...sel):null, sel.length?Math.max(...sel):null);
  }
  $("#priceMin").value = f.priceMin??""; $("#priceMax").value = f.priceMax??"";
  updateRangeOuts();
}
/* push current state.f back into the visible controls (after load / restore) */
function restoreControls(){
  const f = state.f;
  $("#q").value = f.q; $("#qClear").hidden = !f.q;
  $("#rangeSlider").value = f.rangeMin||0;
  $("#fltDeals").checked=f.deals; $("#fltHitch").checked=f.hitch;
  $("#fltNow").checked=f.soon; $("#fltRealPics").checked=f.realPics;
  $("#fltDrops").checked=f.drops;
  $("#kmSel").value = String(state.cfg.km||500);
  $("#sort").value = state.sort;
  syncBrowseMode();
  renderFavCount();
  syncRangeControls();
}
function syncPriceQuick(){
  $$("#priceQuick [data-pq]").forEach(b=>b.classList.toggle("on", state.f.priceMax===Number(b.dataset.pq)));
}
/* prices shift when the km package changes -> rescale the slider bounds to match */
function refreshPriceBounds(){
  if (!state.cars.length || !state.facets) return;
  let pMin=Infinity, pMax=0;
  for(const c of state.cars){
    const p = minPrice(c);
    if (p!=null){ pMin=Math.min(pMin,p); pMax=Math.max(pMax,p); }
  }
  const F = state.facets;
  F.priceMin = pMin===Infinity?0:Math.floor(pMin/10)*10;
  F.priceMax = Math.ceil(pMax/10)*10 || 2000;
  const pr = $("#priceRange");
  if (pr && pr._dr) pr._dr.setBounds(F.priceMin, F.priceMax);
  syncRangeControls();
}
function syncBrowseMode(){
  const mode = state.cfg.browseMode==="models" ? "models" : "cars";
  state.cfg.browseMode = mode;
  $$("#browseSeg button").forEach(b=>{ const on=b.dataset.browse===mode; b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on)); });
  $("#grid").classList.toggle("models",mode==="models");
}

/* ---------------- settings ---------------- */
function openSettings(){
  $("#setBase").value = state.cfg.base;
  $("#setActor").value = state.cfg.actor;
  $("#setProxy").value = state.cfg.proxy || "";
  $("#setView").value = state.cfg.view;
  $("#setLimit").value = String(state.cfg.limit);
  $("#setCrawl").checked = state.cfg.stockCrawl !== false;
  $("#setLargePal").checked = state.cfg.largePalette === true;
  $("#settingsDlg").showModal();
}

