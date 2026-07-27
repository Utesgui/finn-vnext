# FINN vNext — Internal Vehicle Search

A fast, single-file internal UI for searching FINN subscription cars, built directly on the
official **FINN Product API** — the same API that powers finn.com. Unlike the public site,
**all filtering, sorting and search happen instantly in the browser**, so filters always work.

## Quick start

Open `index.html` in any modern browser — that's it. It also works when hosted on any
static host (e.g. **GitHub Pages**): all API calls go browser → anycors → finn.com, so
no server-side code is needed.

By default all API requests are routed through the company CORS proxy
**https://anycors.b0t.at/** to `https://www.finn.com/api/cars`. The app auto-detects
whether the instance expects path-prefix style (`https://anycors.b0t.at/<target-url>`)
or query style (`https://anycors.b0t.at/?url=<encoded>`), and falls back to direct
calls if the proxy is unreachable. The proxy template, base URL and actor are all
editable under ⚙ Settings (placeholders: `{url}` = raw target, `{enc}` = encoded target).

**Fallback without anycors:** `proxy.py` (Python 3, no dependencies) serves the app and
forwards `/api/*` to `www.finn.com` server-side. Note this is a *local* fallback only —
it cannot run on static hosts like GitHub Pages:

```
cd <app folder>
python proxy.py        # then open http://localhost:8020
```

## Features

- **Marketplace-style result cards** — brand logo, photo carousel with dots + counter
  (browse a car's photos without opening it), icon spec row (drivetrain / gearbox / PS /
  seats), prominent monthly price with the all-inclusive note, and availability status.
- **Quick-filter bar** — one-tap presets above the results (Electric, Hybrid, SUV, Estate,
  Automatic, under 300 €, Available now, Deals), synced both ways with the sidebar.
- **Automatic infinite scrolling** — cards render in fast batches and append as the user
  approaches the end; older browsers retain the manual fallback.
- **Model explorer** — the visible **All cars / By model** switch groups only the currently
  matching configurations. Both model cards and individual version cards retain their own
  photo carousel; the version grid also exposes prices, specs, availability, favorites and
  compare actions before entering full details.
- **Instant client-side filtering** — fuel, brand (searchable), body type, monthly price
  (inputs + slider), gearshift, power (kW/PS), electric range, term length, seats, doors,
  color swatches, deals, towbar, "available within 4 weeks", real photos. Most facets are
  **negatable**: click a value once to include it, again to exclude it (e.g. "not Dacia",
  shown struck-through in red and as a `not …` pill), a third time to clear it.
- **Full-text search** across brand, model, trim, equipment line and engine (`/` to focus).
- **Favorites** — heart any car (persisted locally), one-click favorites-only view,
  shareable via URL, exported in CSV.
- **Light & dark theme** — follows the OS preference on first load, toggle in the header
  (or press `t`).
- **Business ↔ Private pricing toggle** (uses the API's `is_for_business` pricing).
- **Sorting**: recommended, price ↑/↓, price drop, power, EV range, soonest availability, brand A–Z.
- **Modern detail view**: immersive photo gallery, prominent all-inclusive subscription
  summary, and a live quote configurator: select real mileage packages and contract terms to
  update monthly price, baseline delta, selected price-table row and full contract total.
  It also includes key-spec highlights, technical pricing, a semantic category equipment
  explorer, color availability, finn.com offer link, plus **Open PDF** and reliable
  **Download PDF** actions. **←/→ navigation** stays within the selected model when opened
  through the version picker, with a back-to-versions action; direct results continue to
  navigate the full filtered list.
- **Compare tray** — pick up to 3 cars, side-by-side spec table.
- **Keyboard-first** — `/` search, `← →` navigate details, `f` favorite, `t` theme,
  `?` shows the shortcut overlay; full focus-visible states and screen-reader labels
  (crisp SVG icons instead of emoji glyphs).
- **Live stats** — cheapest, median price, EV share, brand count for the current result set.
- **CSV export** of the filtered result list (semicolon-separated, Excel-DE friendly).
- **Resilient API layer** — endpoint auto-probing, adaptive page size on errors,
  configurable base URL / actor / view / page size, connection status pill, and a
  load-generation guard so switching Business/Private mid-load can't interleave catalogs.

---

## API research notes (FINN Product API)

Official documentation: **https://docs.product-api.finn.com/** — "Product API (1.0.0),
serves all cars data consumed by our FINN UI".

### Endpoints

**Live endpoints used by the finn.com frontend itself** (confirmed via DevTools on the
production site, July 2026 — same-origin Next.js routes, **no `actor` parameter needed**):

```
GET https://www.finn.com/api/cars            # vehicle listing (Product-API /cars shape)
GET https://www.finn.com/api/filters/cars    # available filter values for the current filter set
    e.g. ?fuels=Elektro&hide_related=true&is_for_business=true&pricing_type=downpayment&view=available_cars
```

**Authentication (confirmed live 2026-07-25):** requests must carry an **`x-finn-actor`
HTTP header** — without it the API answers
`{"message":"api call failed","error":"x-finn-actor header is required"}`.
The app sends the configurable actor value (default `finn-vnext`) as this header on
every request, and probes a few candidates on first load. Note `view=available_cars`
works; `view=available-and-coming-soon` returned HTTP 500 on this route.

**Documented (legacy/internal) host** from the official docs — kept as fallback in the app,
but not reachable from outside:

```
GET https://product-api.finn.com/cars        # Authorization: `actor` query parameter
```

### Query parameters (as documented)

| Group | Parameters |
|---|---|
| Subset | `view` = `available_cars` (default) \| `displayed_cars` \| `coming-soon` \| `available-and-coming-soon` |
| Vehicle filters | `brands`, `models`, `cartypes`, `gearshifts`, `fuels`, `colors`, `features`, `seats`, `doors` (comma-separated lists) |
| Price | `min_price`, `max_price`, `min_price_msrp`, `max_price_msrp`, `pricing_type` = `normal` \| `downpayment` |
| Performance | `min_power`, `max_power` (kW), `min_ev_range`, `max_ev_range` (km) |
| Availability | `available_from`, `available_to` (dates), `terms` (e.g. `12,24,36`) |
| Flags | `is_for_business`, `has_hitch`, `is_young_driver`, `has_deals`, `hide_related` |
| Special | `product_id` (regex), `config_id`, `product_group`, `cug_id` (closed user group), `swap_config_id`, `ml_recommendation` |
| Shaping | `group_by` = `default` \| `brand-model` \| `model-version`, `skip-grouping`, `sort` = `desktop` \| `asc` \| `desc` \| `availability` \| `last_added`, `offset` (default 0), `limit` (default 9) |

### Response shape (per car, most useful fields)

- Identity: `id`, `uid`, `config_id`, `product_path` / `product_link`, `related_configs`
- Naming: `brand.id`, `model`, `model_year`, `trim_name`, `equipment_line`, `config.name`
- Pricing: `price.available_price_list` (**map of term-in-months → monthly price**),
  `price.extra_km_price`, `price.msrp`, `downpayment_prices { downpayment_discount_percentage, … }`
- Availability: `availability`, `available_from`, `available_to`, `available_terms[]`,
  `availability_by_term`
- Specs: `fuel`, `cartype`, `gearshift`, `power` (kW), `ev_range`, `consumption`,
  `co2emission`, `co2_class`, `efficiency_class`, `seats`, `doors`, `engine`,
  `config_drive`, `vehicle_size { width_mm, height_mm, length_mm }`
- Media: `picture.url`, `pictures[].url`, `has_real_pictures`, `brand.helper_brand_logo`
- Documents: `config { link, name }` (the configuration PDF, when supplied)
- Equipment: `equipment { comfort, exterior, interior, multimedia, safety }`,
  `equipment_delimiter`, `equipment_packages`
- Merch: `product_label { label, label_color, … }`, `product_group[]`
- Colors: `color { specific, color_hex }`, `color_list[]` (variants with own pictures/pricing)

Top-level response: `{ offset, results: [ …cars ] }`.

### How this app uses it

The app requests `view=available-and-coming-soon` with `limit=200` pages (auto-shrinking on
errors) and `is_for_business` according to the toggle, walks `offset` until the catalog is
complete, de-duplicates by `config_id`, then does **all** filtering/sorting client-side.
That avoids the filter bugs on the public site and makes every interaction instant.

### Known caveats

- Connection auto-probe order: `<own origin>/api` (when served via proxy.py) →
  `www.finn.com/api` via anycors (path style, then `?url=` style) → direct →
  legacy Product-API hosts. The first working combination is remembered; everything is
  editable in ⚙ Settings without touching the code.
- finn.com's `/api` routes are same-origin routes of their website; cross-origin browser
  calls are handled by the anycors instance (or `proxy.py` as a local fallback).
- Vehicle photos load directly from FINN's CDN (image tags aren't CORS-restricted).
- Checkout/ordering APIs (`apis.finn.auto`) are internal-only (Schufa, Hubspot, Abilipay
  workflow) and are intentionally not used here.
