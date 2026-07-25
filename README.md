# FINN vNext — Internal Vehicle Search

A fast, single-file internal UI for searching FINN subscription cars, built directly on the
official **FINN Product API** — the same API that powers finn.com. Unlike the public site,
**all filtering, sorting and search happen instantly in the browser**, so filters always work.

## Quick start

1. Open `index.html` in any modern browser (Edge / Chrome / Firefox).
2. The app auto-detects the API endpoint, loads the full catalog once, and everything after
   that (search, filters, sort, compare, export) is instant and local.

> If your browser blocks the API call (CORS) when opening the file directly from disk,
> host the file on any intranet web server (e.g. `python -m http.server`) or put it behind
> a small proxy. The app shows a clear banner with diagnostics if this happens, and the
> endpoint + actor are editable under ⚙ Settings.

## Features

- **Instant client-side filtering** — fuel, brand (searchable), body type, monthly price
  (inputs + slider), gearshift, power (kW/PS), electric range, term length, seats, doors,
  color swatches, deals, towbar, "available within 4 weeks", real photos.
- **Full-text search** across brand, model, trim, equipment line and engine (`/` to focus).
- **Business ↔ Private pricing toggle** (uses the API's `is_for_business` pricing).
- **Sorting**: recommended, price ↑/↓, power, EV range, soonest availability, brand A–Z.
- **Detail view**: photo gallery, spec grid, price-per-term table, extra-km price, MSRP,
  equipment (comfort / exterior / interior / multimedia / safety), color variants,
  direct link to the finn.com product page.
- **Compare tray** — pick up to 3 cars, side-by-side spec table.
- **Live stats** — cheapest, median price, EV share, brand count for the current result set.
- **CSV export** of the filtered result list (semicolon-separated, Excel-DE friendly).
- **Resilient API layer** — endpoint auto-probing, adaptive page size on errors,
  configurable base URL / actor / view / page size, connection status pill.

---

## API research notes (FINN Product API)

Official documentation: **https://docs.product-api.finn.com/** — "Product API (1.0.0),
serves all cars data consumed by our FINN UI".

### Endpoint

```
GET /cars
```

Authorization: an `actor` **query parameter** (API-key style). The app sends a configurable
actor value (default `finn-web`, changeable in Settings) and also probes without it.

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

- The base URL is auto-probed (`product-api.finn.com`, then `product-api.finn.auto`) and the
  accepted `actor` value may change over time — both are editable in ⚙ Settings without
  touching the code.
- The API must be reachable from the browser (CORS). finn.com consumes it client-side, so
  this normally works; if your setup blocks it, host the file or add a forwarding proxy.
- Checkout/ordering APIs (`apis.finn.auto`) are internal-only (Schufa, Hubspot, Abilipay
  workflow) and are intentionally not used here.
