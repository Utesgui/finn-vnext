# FINN vNext — Internal Vehicle Search

A fast internal UI for searching FINN subscription inventory. Catalog data is loaded from
FINN's API, then filtering, sorting, grouping, stock aggregation, and search happen locally
in the browser.

## Quick start

Use the included Python server so `/api/*` requests are forwarded same-origin:

```
cd <app folder>
python proxy.py        # then open http://127.0.0.1:8020
```

The server binds only to `127.0.0.1`, has a 30-second upstream timeout, and emits defensive
browser security headers. The browser client also has bounded requests, active cancellation,
endpoint fallback, and a five-minute IndexedDB catalog cache.

Run the zero-dependency regression tests with `npm test` (Node.js 20+ recommended).

### Access control

`<meta name="robots" content="noindex">` prevents indexing; it is **not authentication**.
Do not publish this internal inventory tool on an unauthenticated static host. Any shared
deployment must sit behind an identity-aware gateway, VPN, or equivalent access control.

### Source layout

- `index.html` — semantic document structure, favicon/theme-color wiring, and SVG symbols
- `styles/app.css` — the visual system: self-hosted Inter variable typography, an
  ink-and-teal token set with light "showroom" and dark "night garage" themes,
  layered depth, and the responsive layout
- `assets/favicon.svg` + `favicon.ico` + `assets/apple-touch-icon.png` — the app icon
  (regenerate the bitmaps with `make-icons.ps1`)
- `assets/fonts/` — Inter variable woff2 subsets, bundled under the SIL Open Font
  License (see `LICENSE-Inter.txt`); served same-origin so the CSP stays strict
- `js/domain.js` — pure, tested filters/pricing/availability/stock logic
- `js/core.js` — shared configuration, state, helpers, and equipment utilities
- `js/api.js` — price tracking, API loading, caching, and catalog facets
- `js/ui.js` — filtering, rendering, dialogs, comparison, export, and URL state
- `js/events.js` — event wiring and application boot
- `tests/domain.test.js` — Node test suite
- `proxy.py` — local static/API server

## Features

- **Marketplace-style result cards** — brand logo, photo carousel with dots + counter
  (browse a car's photos without opening it), icon spec row (drivetrain / gearbox / PS /
  seats), prominent monthly price with the all-inclusive note, and availability status.
- **Quick-filter bar** — one-tap presets above the results (Electric, Hybrid, SUV, Estate,
  Automatic, under 300 €, within 4 weeks, Deals), synced both ways with the sidebar.
- **Automatic infinite scrolling** — cards render in fast batches and append as the user
  approaches the end; older browsers retain the manual fallback.
- **Model explorer** — the visible **Configurations / By model** switch groups only the currently
  matching configurations. Both model cards and individual version cards retain their own
  photo carousel; the version grid also exposes prices, specs, availability, favorites and
  compare actions before entering full details. Model cards aggregate the API's real
  customer-visible stock across matching configurations; version cards show their own units.
- **Instant client-side filtering** — fuel, brand (searchable), body type, monthly price
  (inputs + slider), gearshift, power (kW/PS), electric range, term length, seats, doors,
  color swatches, deals, towbar, "available within 4 weeks", real photos. Most facets are
  **negatable**: click a value once to include it, again to exclude it (e.g. "not Dacia",
  shown struck-through in red and as a `not …` pill), a third time to clear it.
- **Full-text search** across brand, model, trim, equipment line and engine (`/` to focus).
- **Favorites** — heart any car (persisted locally), one-click favorites-only view,
  shareable via URL, exported in CSV.
- **Light & dark theme** — follows the OS preference on first load, toggle in the header
  (or press `t`); the switch cross-fades via the View Transitions API where available and
  keeps the browser UI (`theme-color`) in sync.
- **Business ↔ Private pricing toggle** (uses the API's `is_for_business` pricing).
- **Sorting**: recommended, recently added, price ↑/↓, price drop, power, EV range, soonest availability, brand A–Z.
- The app requests `view=available_cars` in newest-first (`last_added`) pages (default `limit=200`) and separately attempts
- **"New" tracking (first seen)** — the API exposes no created/added timestamp, so the
  app records when it first sees each config (locally, after a baseline first load).
  Newly appeared configs get a **new** badge with the exact first-seen day & time,
  a result-stats counter, and power the "Recently added" sort; the detail view's
  footer line shows the precise timestamp.
- **Modern detail view**: immersive photo gallery, prominent all-inclusive subscription
  summary, and a live quote configurator: select real mileage packages and contract terms to
  update monthly price, baseline delta, selected price-table row and full contract total.
  It also includes key-spec highlights, technical pricing, all equipment categories shown
  as stacked sections, named option **packages**, tire type & size, interior color,
  and an **interactive color switcher** below the gallery: click a color chip to jump
  to that variant with its own photos, pricing and availability (resolved from the
  local catalog, or fetched live via `config_id` when the sibling isn't loaded),
  finn.com offer link, plus **Open PDF** and reliable
  **Download PDF** actions. **←/→ navigation** stays within the selected model when opened
  through the version picker, with a back-to-versions action; direct results continue to
  navigate the full filtered list.
- **Compare tray** — pick up to 3 cars, side-by-side spec table.
- **Keyboard-first** — `/` search, `← →` navigate details, `f` favorite, `t` theme,
  `?` shows the shortcut overlay; full focus-visible states and screen-reader labels
  (crisp SVG icons instead of emoji glyphs).
- **Live stats** — cheapest, median price, EV share, brand count for the current result set.
- **CSV export** of the filtered result list (semicolon-separated and Excel-friendly).
- **Resilient API layer** — bounded requests, active cancellation, endpoint fallback,
  adaptive page size for server errors, five-minute IndexedDB caching, and stale-load guards.

---

## API research notes (FINN Product API)

Official documentation: **https://docs.product-api.finn.com/** — "Product API (1.0.0),
serves all cars data consumed by our FINN UI".

### Endpoints

**Live endpoints used by the finn.com frontend itself** (confirmed via DevTools on the
production site, July 2026 — same-origin Next.js routes):

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
- Stock: `product_stock_webflow` (customer-visible units), `product_stock_total`
  (fallback/total units), `product_stock_preorder`, `states_stock`
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

The app requests `view=available_cars` in pages (default `limit=200`) and separately attempts
the optional `coming-soon` bucket before merging and de-duplicating by `config_id`. It shrinks
page size only for retryable server/request-size errors. Business/private mode changes the API
pricing mode. A fresh catalog is cached in IndexedDB for five minutes; explicit retry or saved
settings bypass the cache. Filtering, grouping, stock totals, and sorting then run client-side.

### Known caveats

- Connection probe order: saved configuration → `<own origin>/api` (when served via
  `proxy.py`) → configured CORS/API fallbacks. Each probe is bounded to six seconds; catalog
  requests are bounded to 30 seconds. Superseded loads are actively aborted.
- Connectivity fields are available under **Settings → Advanced API diagnostics** and should
  normally remain untouched.
- finn.com's `/api` routes are same-origin routes of their website; cross-origin browser
  calls are handled by the anycors instance (or `proxy.py` as a local fallback).
- Vehicle photos load directly from FINN's CDN (image tags aren't CORS-restricted).
- Checkout/ordering APIs (`apis.finn.auto`) are internal-only (Schufa, Hubspot, Abilipay
  workflow) and are intentionally not used here.
- `available_from` is interpreted as a local calendar date. Only today/past is labelled
  **available now**; future dates are always shown explicitly.
