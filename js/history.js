"use strict";
/* ---------------- price history panel (detail view) ---------------- */
const HISTORY_RANGE_TEXT = {
  day:{period:"last 30 days",point:"closing price per day"},
  week:{period:"last 26 weeks",point:"closing price per week"}
};
const HISTORY_CHANGE_ROWS = 5;
const TREND_DAYS = 30;
const TREND_WIDTH = 96;
const TREND_HEIGHT = 26;
const fmtHistoryDay = ms => new Date(ms).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
const fmtHistoryDate = ms => new Date(ms).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const fmtHistoryTime = ms => `${fmtHistoryDay(ms)}, ${new Date(ms).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`;
const historyRange = () => state.cfg.historyRange==="week" ? "week" : "day";
const historyDelta = delta => `${delta>0?"+":"−"}${fmtEur(Math.abs(delta))}`;

/* The published history plus this session's catalog as the newest observation. */
const priceHistoryForCar = car => FinnDomain.recordPriceObservation((state.historyIndex||{})[carKey(car)],car.price,state.catalogAt||Date.now());

function priceHistoryPanelMarkup(){
  const range = historyRange();
  const button = (value,label)=>`<button data-history-range="${value}" class="${range===value?"on":""}" aria-pressed="${range===value}">${label}</button>`;
  return `<section class="detail-panel detail-history" data-price-history>
    <div class="detail-panel-head">
      <div><h3>Price history</h3><p data-history-context></p></div>
      <div class="seg" data-history-seg role="group" aria-label="Price history resolution">${button("day","Days")}${button("week","Weeks")}</div>
    </div>
    <div class="ph-body" data-history-body></div>
  </section>`;
}

/* Wires the panel for one car and returns its redraw function. */
function initPriceHistory(dlg,car,getQuote){
  const panel = dlg.querySelector("[data-price-history]"), body = panel.querySelector("[data-history-body]");
  if(state.historyObserver) state.historyObserver.disconnect();
  let result = {status:"loading"};
  const render = () => { if(panel.isConnected) renderPriceHistory(panel,body,result,getQuote()); };
  panel.querySelector("[data-history-seg]").addEventListener("click",e=>{
    const button = e.target.closest("[data-history-range]");
    if(!button||button.dataset.historyRange===historyRange()) return;
    state.cfg.historyRange = button.dataset.historyRange; saveCfg();
    panel.querySelectorAll("[data-history-range]").forEach(b=>{ const on=b===button; b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on)); });
    render();
  });
  if("ResizeObserver" in window){
    let size = "";
    state.historyObserver = new ResizeObserver(([entry])=>{
      const {width,height} = entry.contentRect, next = `${Math.round(width)}x${Math.round(height)}`;
      if(!width||next===size) return;
      size = next;
      if(result.status==="ok") render();
    });
    state.historyObserver.observe(body);
  }
  render();
  loadPriceHistory().then(()=>{
    const data = priceHistoryForCar(car);
    result = data ? {status:"ok",data} : {status:"untracked"};
    render();
  });
  return render;
}

function renderPriceHistory(panel,body,result,quote){
  const range = historyRange();
  panel.querySelector("[data-history-context]").textContent =
    [quote.term?`${quote.term} months`:null,`${fmtNum(quote.km)} km/month`,state.cfg.biz?"Business":"Private",quote.oneTime?"before one-time payment":null,HISTORY_RANGE_TEXT[range].period].filter(Boolean).join(" · ");
  const note = text => { body.innerHTML = `<p class="ph-note">${esc(text)}</p>`; };
  if(result.status==="loading") return note("Loading price history…");
  if(result.status==="untracked") return note("No price data recorded for this vehicle yet.");
  const series = FinnDomain.priceHistorySeries(result.data,{granularity:range,km:quote.km,term:quote.term,business:state.cfg.biz});
  if(series.current==null) return note("No recorded price for this contract length in the selected period.");
  const stat = (label,value)=>`<div class="cell"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div></div>`;
  const pointCount = series.buckets.filter(b=>b.price!=null).length;
  const changesOpen = !!body.querySelector(".ph-changes[open]");
  const footer = [
    `Tracked since ${fmtHistoryDate(result.data.firstSeen)}`,
    `last check ${fmtHistoryTime(result.data.lastSeen)}`,
    HISTORY_RANGE_TEXT[range].point
  ].join(" · ");
  body.innerHTML = `
    <div class="kv detail-kv ph-stats">
      ${stat("Now",fmtEur(series.current))}${stat("Lowest",fmtEur(series.low))}${stat("Highest",fmtEur(series.high))}${stat("Change",series.delta?historyDelta(series.delta):"no change")}
    </div>
    <div class="ph-chart" tabindex="0" role="group" aria-label="${esc(priceHistorySummary(series))}. Use the left and right arrow keys to read each point."></div>
    ${priceHistoryChangesMarkup(series,changesOpen)}
    <p class="ph-note">${esc(footer)}${pointCount<2?". The line builds up with every further check.":""}</p>`;
  const host = body.querySelector(".ph-chart"), changes = body.querySelector(".ph-changes");
  drawPriceHistoryChart(host,series);
  if(changes) changes.addEventListener("toggle",()=>drawPriceHistoryChart(host,series));
}

function priceHistorySummary(series){
  const period = HISTORY_RANGE_TEXT[series.granularity].period;
  return `Monthly price over the ${period}: now ${fmtEur(series.current)}, lowest ${fmtEur(series.low)}, highest ${fmtEur(series.high)}`;
}

function priceHistoryChangesMarkup(series,open){
  if(!series.changes.length) return `<p class="ph-note">No price change in the ${HISTORY_RANGE_TEXT[series.granularity].period}.</p>`;
  const rows = series.changes.slice(0,HISTORY_CHANGE_ROWS).map(change=>`<tr><td>${esc(fmtHistoryTime(change.t))}</td><td><span class="quote-change ${change.delta<0?"down":"up"}">${change.delta<0?"▼":"▲"} ${esc(historyDelta(change.delta))}</span></td><td class="num">${esc(fmtEur(change.to))}</td></tr>`).join("");
  const hidden = series.changes.length-HISTORY_CHANGE_ROWS;
  return `<details class="ph-changes"${open?" open":""}><summary>Price changes (${fmtNum(series.changes.length)})</summary><div class="detail-price-table"><table class="ptable"><thead><tr><th>Changed on</th><th>Change</th><th>New price</th></tr></thead><tbody>${rows}</tbody></table></div>${hidden>0?`<p class="ph-note">${fmtNum(hidden)} earlier ${hidden===1?"change":"changes"} in this period not listed.</p>`:""}</details>`;
}

const historyLastIndex = series => series.buckets.reduce((found,bucket,index)=>bucket.price!=null?index:found,-1);

/* Step line: a subscription price holds until the next change. */
function historyStepPath(buckets,xAt,yAt){
  let path = "", previous = null;
  buckets.forEach((bucket,index)=>{
    if(bucket.price==null){ previous = null; return; }
    const x = xAt(index).toFixed(1), y = yAt(bucket.price).toFixed(1);
    path += previous==null ? `M${x} ${y}` : `H${x}V${y}`;
    previous = bucket.price;
  });
  return path;
}

function drawPriceHistoryChart(host,series){
  const margin = {top:12,right:56,bottom:26,left:46};
  const width = host.clientWidth||640, height = host.clientHeight||200;
  const plotWidth = Math.max(40,width-margin.left-margin.right), plotHeight = height-margin.top-margin.bottom;
  const axis = FinnDomain.historyAxis(series.low,series.high);
  const count = series.buckets.length;
  const xAt = index => margin.left+(index+.5)*plotWidth/count;
  const yAt = value => margin.top+plotHeight*(1-(value-axis.min)/(axis.max-axis.min));
  const path = historyStepPath(series.buckets,xAt,yAt);
  let dots = "";
  series.buckets.forEach((bucket,index)=>{
    const before = index ? series.buckets[index-1].price : null;
    if(bucket.price!=null&&before!=null&&before!==bucket.price) dots += `<circle class="ph-dot" cx="${xAt(index).toFixed(1)}" cy="${yAt(bucket.price).toFixed(1)}" r="5"/>`;
  });
  const lastX = xAt(historyLastIndex(series)), lastY = yAt(series.current);
  dots += `<circle class="ph-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="5"/>`;
  const grid = axis.ticks.map(tick=>{
    const y = yAt(tick).toFixed(1);
    return `<line class="ph-grid" x1="${margin.left}" x2="${margin.left+plotWidth}" y1="${y}" y2="${y}"/><text class="ph-axis" x="${margin.left-8}" y="${y}" text-anchor="end" dominant-baseline="middle">${esc(fmtEur(tick))}</text>`;
  }).join("");
  const labelEvery = Math.max(1,Math.ceil(count/Math.max(2,Math.floor(plotWidth/72))));
  let xLabels = "";
  for(let index = count-1; index>=0; index-=labelEvery)
    xLabels += `<text class="ph-axis" x="${xAt(index).toFixed(1)}" y="${height-6}" text-anchor="middle">${esc(fmtHistoryDay(series.buckets[index].start))}</text>`;
  host.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    ${grid}${xLabels}
    <line class="ph-cross" x1="0" x2="0" y1="${margin.top}" y2="${margin.top+plotHeight}"/>
    <path class="ph-line" d="${path}"/>${dots}
    <text class="ph-end" x="${(lastX+10).toFixed(1)}" y="${lastY.toFixed(1)}" dominant-baseline="middle">${esc(fmtEur(series.current))}</text>
  </svg><div class="ph-tip" role="status"><b></b><span></span></div>`;
  wirePriceHistoryHover(host,series,xAt,plotWidth,margin.left);
}

function wirePriceHistoryHover(host,series,xAt,plotWidth,left){
  const cross = host.querySelector(".ph-cross"), tip = host.querySelector(".ph-tip");
  const populated = series.buckets.map((bucket,index)=>bucket.price!=null?index:-1).filter(index=>index>=0);
  let activeIndex = populated[populated.length-1];
  const show = index => {
    activeIndex = index;
    const bucket = series.buckets[index], x = xAt(index);
    cross.setAttribute("x1",x); cross.setAttribute("x2",x);
    cross.style.visibility = "visible";
    tip.querySelector("b").textContent = `${fmtEur(bucket.price)} / month`;
    tip.querySelector("span").textContent = series.granularity==="week" ? `Week of ${fmtHistoryDate(bucket.start)}` : fmtHistoryDate(bucket.start);
    const half = tip.offsetWidth/2, clamped = Math.min(Math.max(x,half),host.clientWidth-half);
    tip.style.transform = `translateX(${(clamped-half).toFixed(1)}px)`;
    tip.style.visibility = "visible";
  };
  const hide = () => { cross.style.visibility = "hidden"; tip.style.visibility = "hidden"; };
  host.onpointermove = e => {
    const scale = host.clientWidth/host.querySelector("svg").viewBox.baseVal.width;
    const pointer = (e.clientX-host.getBoundingClientRect().left)/scale;
    const raw = (pointer-left)/plotWidth*series.buckets.length-.5;
    show(populated.reduce((best,index)=>Math.abs(index-raw)<Math.abs(best-raw)?index:best,populated[0]));
  };
  host.onpointerleave = () => { if(document.activeElement!==host) hide(); };
  host.onfocus = () => show(activeIndex);
  host.onblur = hide;
  host.onkeydown = e => {
    if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight") return;
    e.preventDefault();
    e.stopPropagation(); // the arrows otherwise step to the next vehicle
    const position = populated.indexOf(activeIndex)+(e.key==="ArrowRight"?1:-1);
    show(populated[Math.min(Math.max(position,0),populated.length-1)]);
  };
}

/* ---------------- price trend on the result cards ---------------- */
function syncTrendToggle(){
  const on = state.cfg.showTrends===true;
  $("#trendToggle").classList.toggle("on",on);
  $("#trendToggle").setAttribute("aria-pressed",String(on));
}

function refreshCardTrends(){ $$("#grid .card, #versionsDlg .version-card").forEach(paintCardTrend); }

function paintCardTrend(card){
  const slot = card.querySelector("[data-trend]");
  if(slot) slot.innerHTML = state.cfg.showTrends&&state.historyIndex ? cardTrendMarkup(card._trendCars) : "";
}

function cardTrendMarkup(cars){
  const terms = state.f.terms.map(Number), now = new Date();
  const list = cars.map(priceHistoryForCar).filter(Boolean)
    .map(history=>FinnDomain.priceHistorySeries(history,{count:TREND_DAYS,km:state.cfg.km,business:state.cfg.biz,terms,now}));
  const series = list.length===1 ? list[0] : FinnDomain.lowestHistorySeries(list);
  if(!series||series.current==null) return "";
  const firstPriced = series.buckets.find(bucket=>bucket.price!=null);
  const period = series.buckets[0].price!=null ? `${TREND_DAYS} days` : `since ${fmtHistoryDay(firstPriced.start)}`;
  const change = series.delta ? `<i class="${series.delta<0?"down":"up"}">${series.delta<0?"▼":"▲"}</i> ${esc(historyDelta(series.delta))}` : "no change";
  return `${cardTrendSvg(series,period)}<span class="delta">${change}</span><span class="period">${esc(period)}</span>`;
}

function cardTrendSvg(series,period){
  const pad = 5, span = series.high-series.low, count = series.buckets.length;
  const xAt = index => pad+(index+.5)*(TREND_WIDTH-pad*2)/count;
  const yAt = value => span ? pad+(TREND_HEIGHT-pad*2)*(1-(value-series.low)/span) : TREND_HEIGHT/2;
  const label = `Price trend, ${period}: now ${fmtEur(series.current)}, lowest ${fmtEur(series.low)}, highest ${fmtEur(series.high)}`;
  return `<svg width="${TREND_WIDTH}" height="${TREND_HEIGHT}" viewBox="0 0 ${TREND_WIDTH} ${TREND_HEIGHT}" role="img" aria-label="${esc(label)}"><path class="ph-line" d="${historyStepPath(series.buckets,xAt,yAt)}"/><circle class="ph-dot" cx="${xAt(historyLastIndex(series)).toFixed(1)}" cy="${yAt(series.current).toFixed(1)}" r="4"/></svg>`;
}
