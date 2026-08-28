"use strict";
/* ---------------- events ---------------- */
/* key-based lookup (not a captured array reference), so the groups keep working
   after resetFilters() replaces state.f */
function chipGroup(sel, key, negatable=true){
  $(sel).addEventListener("click", e=>{
    const btn = e.target.closest("[data-chip]"); if(!btn) return;
    const arr = state.f[key];
    const v = btn.dataset.chip;
    if (negatable) cycleFacet(arr, v);
    else{ const i = arr.indexOf(v); if(i>=0) arr.splice(i,1); else arr.push(v); }
    syncChipStates();
    apply();
  });
}
function wireEvents(){
  const setUtilityMenu = open => {
    $(".header-actions").classList.toggle("menu-open",open);
    $("#utilityMenuBtn").setAttribute("aria-expanded",String(open));
  };
  $("#q").addEventListener("input", debounce(e=>{ state.f.q = e.target.value; $("#qClear").hidden = !e.target.value; apply(); }, 180));
  $("#qClear").addEventListener("click", ()=>{ $("#q").value=""; state.f.q=""; $("#qClear").hidden=true; apply(); $("#q").focus(); });
  document.addEventListener("keydown", e=>{
    const typing = /input|select|textarea/i.test(document.activeElement.tagName);
    if (e.key==="/" && !typing){ e.preventDefault(); $("#q").focus(); }
    if (e.key==="Escape"){ $$( "dialog[open]" ).forEach(d=>d.close()); setDrawer(false); setUtilityMenu(false); }
    const detailOpen = $("#detailDlg").open;
    if (detailOpen && e.key==="ArrowLeft"){ e.preventDefault(); stepDetail(-1); }
    if (detailOpen && e.key==="ArrowRight"){ e.preventDefault(); stepDetail(1); }
    if (detailOpen && (e.key==="f"||e.key==="F") && !typing && state.detailKey){ e.preventDefault(); toggleFav(state.detailKey); }
    if ((e.key==="t"||e.key==="T") && !typing && !detailOpen){ toggleTheme(); }
    if (e.key==="?" && !typing){ e.preventDefault(); $("#helpDlg").showModal(); }
  });
  // click on the dimmed backdrop closes a dialog
  ["versionsDlg","detailDlg","cmpDlg","settingsDlg","helpDlg"].forEach(id=>{
    const d = $("#"+id);
    d.addEventListener("click", e=>{ if (e.target === d) d.close(); });
  });
  // mobile filter drawer
  const setDrawer = open => {
    document.body.classList.toggle("drawer-open", open);
    $("#fabFilters").setAttribute("aria-expanded", String(open));
    if (open) $("#drawerClose").focus();
  };
  $("#fabFilters").addEventListener("click", ()=>setDrawer(!document.body.classList.contains("drawer-open")));
  $("#drawerClose").addEventListener("click", ()=>setDrawer(false));
  $("#drawerBg").addEventListener("click", ()=>setDrawer(false));
  $("#utilityMenuBtn").addEventListener("click",e=>{
    e.stopPropagation();
    setUtilityMenu(!$(".header-actions").classList.contains("menu-open"));
  });
  $("#utilityActions").addEventListener("click",()=>setUtilityMenu(false));
  document.addEventListener("click",e=>{ if(!e.target.closest(".header-actions")) setUtilityMenu(false); });
  // quick price presets
  $("#priceQuick").addEventListener("click", e=>{
    const btn = e.target.closest("[data-pq]"); if(!btn) return;
    const v = Number(btn.dataset.pq);
    state.f.priceMax = (state.f.priceMax===v) ? null : v;
    $("#priceMax").value = state.f.priceMax??"";
    $("#priceSlider").value = state.f.priceMax??$("#priceSlider").max;
    updateRangeOuts(); apply();
  });
  // share the current view (filters live in the URL)
  $("#shareBtn").addEventListener("click", async ()=>{
    try{ await navigator.clipboard.writeText(location.href); toast("Link to this view copied"); }
    catch(e){ toast("Couldn't copy automatically — use the address bar URL"); }
  });
  // The button remains a fallback for browsers without IntersectionObserver.
  if (AUTO_LOAD){
    new IntersectionObserver(entries=>{
      if (entries.some(en=>en.isIntersecting)) scheduleAutoFill();
    }, {rootMargin:"600px 0px"}).observe($("#sentinel"));
  }
  $("#versionsDlg").addEventListener("click",e=>{
    const shot=e.target.closest("[data-shot]");
    if(shot){e.stopPropagation();stepShot(shot.closest(".version-card"),Number(shot.dataset.shot));return;}
    const pal=e.target.closest("[data-pal]");
    if(pal){e.stopPropagation();openVersionDetail(pal.closest("[data-version]").dataset.version, pal.dataset.pal);return;}
    const opener=e.target.closest("[data-open-version]");
    if(opener){openVersionDetail(opener.closest("[data-version]").dataset.version);return;}
    if(e.target.closest("button")) return;
  });
  chipGroup("#fuelChips", "fuels");
  chipGroup("#typeChips", "types");
  chipGroup("#gearChips", "gears");
  chipGroup("#termChips", "terms", false);
  chipGroup("#seatChips", "seats");
  chipGroup("#doorChips", "doors");
  chipGroup("#colorSwatches", "colors");
  $("#brandSearch").addEventListener("input", e=>renderBrandList(e.target.value));
  $("#brandList").addEventListener("click", e=>{
    const row = e.target.closest(".checkrow"); if(!row) return;
    const cb = row.querySelector("[data-brand]"); if(!cb) return;
    e.preventDefault();
    cycleFacet(state.f.brands, cb.dataset.brand);
    syncChipStates();
    apply();
  });
  $("#priceMin").addEventListener("change", e=>{ state.f.priceMin = e.target.value===""?null:Number(e.target.value); apply(); });
  $("#priceMax").addEventListener("change", e=>{ state.f.priceMax = e.target.value===""?null:Number(e.target.value); $("#priceSlider").value = e.target.value||$("#priceSlider").max; apply(); });
  $("#priceSlider").addEventListener("input", debounce(e=>{
    state.f.priceMax = Number(e.target.value)>=Number(e.target.max)?null:Number(e.target.value);
    $("#priceMax").value = state.f.priceMax??"";
    updateRangeOuts(); apply();
  }, 120));
  $("#powerSlider").addEventListener("input", debounce(e=>{ state.f.powerMin = Number(e.target.value); updateRangeOuts(); apply(); }, 120));
  $("#rangeSlider").addEventListener("input", debounce(e=>{ state.f.rangeMin = Number(e.target.value); updateRangeOuts(); apply(); }, 120));
  $("#kmSel").addEventListener("change", e=>{
    state.cfg.km = Number(e.target.value)||500; saveCfg();
    refreshPriceBounds();
    apply();
    if (state.f.priceMax!=null)
      toast(`Prices now include ${fmtNum(state.cfg.km)} km/mo — your ≤ ${fmtEur(state.f.priceMax)} cap trims the list`);
    else
      toast(`Prices now include the ${fmtNum(state.cfg.km)} km/month package`);
  });
  $("#densitySeg").addEventListener("click", e=>{
    const btn = e.target.closest("[data-den]"); if(!btn) return;
    state.cfg.density = btn.dataset.den; saveCfg();
    $$("#densitySeg button").forEach(b=>{ b.classList.toggle("on", b===btn); b.setAttribute("aria-pressed", String(b===btn)); });
    $("#grid").classList.toggle("list", state.cfg.density==="list");
  });
  $("#browseSeg").addEventListener("click",e=>{
    const btn=e.target.closest("[data-browse]"); if(!btn||btn.dataset.browse===state.cfg.browseMode) return;
    state.cfg.browseMode=btn.dataset.browse; saveCfg(); syncBrowseMode(); apply();
    toast(state.cfg.browseMode==="models"?"Grouped by model — choose a card to compare versions":"Showing individual configurations");
  });
  [["fltDeals","deals"],["fltHitch","hitch"],["fltNow","soon"],["fltRealPics","realPics"],["fltDrops","drops"]].forEach(([id,prop])=>{
    $("#"+id).addEventListener("change", e=>{ state.f[prop]=e.target.checked; apply(); });
  });
  $("#quickBar").addEventListener("click", e=>{
    const btn = e.target.closest("[data-qf]"); if(!btn) return;
    const items = $("#quickBar")._items || [];
    const item = items[Number(btn.dataset.qf)]; if(!item) return;
    item.go();
    syncChipStates(); apply();
  });
  $("#resetBtn").addEventListener("click", resetFilters);
  $("#sort").addEventListener("change", e=>{ state.sort=e.target.value; apply(); });
  $("#moreBtn").addEventListener("click", ()=>renderGrid(false));
  $("#bizSeg").addEventListener("click", e=>{
    const btn = e.target.closest("[data-biz]"); if(!btn) return;
    const biz = btn.dataset.biz==="true";
    if (biz===state.cfg.biz) return;
    state.cfg.biz = biz; saveCfg();
    $$("#bizSeg button").forEach(b=>{ b.classList.toggle("on", b===btn); b.setAttribute("aria-pressed", String(b===btn)); });
    loadCatalog();
  });
  $("#grid").addEventListener("click", e=>{
    const shot = e.target.closest("[data-shot]");
    if (shot){ e.stopPropagation(); stepShot(shot.closest(".card"), Number(shot.dataset.shot)); return; }
    const pal = e.target.closest("[data-pal]");
    if (pal){
      e.stopPropagation();
      const holder = pal.closest("[data-key]");
      const c = holder && state.cars.find(x=>carKey(x)===holder.dataset.key);
      if (c) openDetail(c, {colorUid: pal.dataset.pal});
      return;
    }
    const fav = e.target.closest("[data-fav]");
    if (fav){ e.stopPropagation(); toggleFav(fav.dataset.fav); return; }
    const cmp = e.target.closest("[data-cmp]");
    if (cmp){ e.stopPropagation(); toggleCompare(cmp.dataset.cmp); return; }
    const opener=e.target.closest("[data-open-group],[data-open-car]");
    if(!opener) return;
    const card=opener.closest(".card");
    if(opener.matches("[data-open-group]")){ openVersions(findModelGroup(card.dataset.group)); return; }
    const c = state.cars.find(x=>carKey(x)===card.dataset.key);
    if (c) openDetail(c);
  });
  document.addEventListener("click", e=>{
    const closer = e.target.closest("[data-close]");
    if (closer) $("#"+closer.dataset.close).close();
    const favIn = e.target.closest("dialog [data-fav]");
    if (favIn){ toggleFav(favIn.dataset.fav); return; }
    const cmpIn = e.target.closest("dialog [data-cmp]");
    if (cmpIn){ toggleCompare(cmpIn.dataset.cmp); }
  });
  $("#cmpGo").addEventListener("click", openCompare);
  $("#cmpClear").addEventListener("click", ()=>{ state.compare=[]; $$(".cmpbtn").forEach(b=>{b.classList.remove("on");b.setAttribute("aria-pressed","false");}); renderCmpBar(); });
  $("#exportBtn").addEventListener("click", exportCsv);
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#helpBtn").addEventListener("click", ()=>$("#helpDlg").showModal());
  $("#favToggle").addEventListener("click", ()=>{
    state.f.favOnly = !state.f.favOnly;
    if (state.f.favOnly && !state.favs.size){ state.f.favOnly=false; toast("No favorites yet — tap the heart on a vehicle card"); return; }
    renderFavCount(); apply();
  });
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#setSave").addEventListener("click", ()=>{
    const pasted = $("#setPaste").value.trim();
    if (pasted){
      try{
        const u = new URL(pasted);
        const idx = u.pathname.indexOf("/cars");
        $("#setBase").value = u.origin + (idx>0 ? u.pathname.slice(0, idx) : "");
        if (u.searchParams.has("actor")) $("#setActor").value = u.searchParams.get("actor");
        $("#setPaste").value = "";
      }catch(e){ /* not a valid URL — ignore and use the manual fields */ }
    }
    state.cfg.base  = $("#setBase").value.trim() || DEFAULTS.base;
    state.cfg.actor = $("#setActor").value.trim();
    state.cfg.proxy = $("#setProxy").value.trim();
    state.cfg.view  = $("#setView").value;
    state.cfg.limit = Number($("#setLimit").value)||200;
    state.cfg.stockCrawl = $("#setCrawl").checked;
    saveCfg();
    $("#settingsDlg").close();
    loadCatalog({force:true});
  });
}

/* ---------------- boot ---------------- */
(function boot(){
  applyTheme();
  // a shared/bookmarked URL restores its exact filter view (and skips the EV default)
  if (readHash()) state.evDefaulted = true;
  $$("#bizSeg button").forEach(b=>{ const on=(b.dataset.biz==="true")===state.cfg.biz; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  $("#grid").classList.toggle("list", state.cfg.density==="list");
  syncBrowseMode();
  $$("#densitySeg button").forEach(b=>{ const on=b.dataset.den===(state.cfg.density||"grid"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  renderFavCount();
  wireEvents();
  ["pointerdown","keydown"].forEach(ev=>document.addEventListener(ev, ()=>{ state.userTouched = true; }, {once:true, capture:true}));
  hydrateStockSnapshot();
  loadCatalog();
})();
