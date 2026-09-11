# AU Fast Food Value Finder

Live URL:

https://skermiebrotech.github.io/fast-food-value-au/

A modern, no-build GitHub Pages website for comparing Australian fast food value by:

- grams per dollar
- kilojoules per dollar
- calories per dollar
- protein grams per dollar
- budget-fit items under a user-entered AUD budget
- value and combo comparisons across McDonald's, Pizza Hut, GYG, Red Rooster, Oporto and Carl's Jr — every row pulled straight from each chain's own ordering system, no third-party or crowd-sourced menus

Prices are **Queensland-specific**. Every row in `data/foods.json` is pulled directly
from a chain's own ordering system by `scripts/fetch_menus.py` (see
[Live menu data](#live-menu-data)) — there is no hand-curated, crowd-sourced or
third-party data in the shipped dataset.

Third-party and manual sources (Frugal Feeds, kfcmenuprice.au, and the workbooks in
`sources/`) were removed on 2026-09-11 so that every price and kilojoule figure can be
traced to the restaurant itself. Chains without a reachable first-party API — KFC,
Domino's, Subway, Grill'd and Hungry Jack's — are therefore not currently listed;
they return only once their own menu can be read directly.

The browser loads the public dataset from `data/foods.json`. Prices vary by store, app
account, delivery channel and time, so check the chain's own app before relying on them.

## Features

- Static GitHub Pages compatible: no backend, no build step, no database.
- Responsive mobile cards and desktop comparison table.
- Search, brand/category filters, price cap, and metric-based sorting.
- Budget planner that finds best items under a selected budget.
- Meal combo finder that builds the best 2–4 item food combinations under a budget, with brand and metric controls. Drinks/sauces are ignored and each combo uses at most one bundled meal deal/box/shared meal.
- Add, edit, and delete food items in the browser.
- Local edits are saved to `localStorage` so personal changes persist on the same device.
- Export JSON to update the shared repository dataset.
- Import JSON for quick local refreshes.
- Progressive Web App basics: `manifest.webmanifest`, service worker caching, SVG icon.
- GitHub Pages helpers: `.nojekyll`, `404.html`, `robots.txt`, `sitemap.xml`, and a Pages deployment workflow.

## Run locally

From this directory:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Do not open `index.html` directly from the filesystem if you want the service worker and JSON fetch behaviour to match GitHub Pages.

## Live menu data

`scripts/fetch_menus.py` refreshes `data/foods.json` from the chains that publish a
reachable menu API. It needs Python 3.10+ and nothing else — standard library only.

```bash
python3 scripts/fetch_menus.py --location 4000
```

`--location` accepts a postcode, a suburb name, or a `lat,lng` pair. Every one of these
chains prices per store, so the fetcher resolves each brand's **nearest Queensland store**
to that point independently and records which one it used in `metadata.liveFetch`.
Geocoding uses the chains' own published store coordinates, so there is no external
geocoding service or API key involved.

| Brand | What the API gives | Notes |
|---|---|---|
| McDonald's | price + kJ | My Macca's app API (`ap-prod.api.mcd.com`) with OAuth credentials extracted from the APK; needs `curl_cffi` for the Akamai TLS fingerprint |
| Pizza Hut | price + kJ | Both from one call |
| Red Rooster | price + kJ | Prices are integer cents in the feed |
| Oporto | price + kJ | kJ present on only ~54% of items; rest are price-only |
| GYG | price only | kJ joined from `data/gyg_nutrition.json` (GYG's own nutrition guide) |
| Carl's Jr | price + kJ | My Carl's app API; `/sites` has no coordinates, so a QLD suburb table picks the store |

Useful flags:

```bash
python3 scripts/fetch_menus.py --location "Surfers Paradise" --dry-run
python3 scripts/fetch_menus.py --location 4870 --brands red-rooster,oporto
python3 scripts/fetch_menus.py --location 4000 --channels pickup
python3 scripts/fetch_menus.py --location 4000 --keep-manual
```

### Pickup and delivery are separate rows

Roughly half of all items are priced differently between pickup and delivery, sometimes by
more than double (Red Rooster Cheesy Garlic Bites: $5.00 pickup, $10.75 delivery). Mixing
them would silently corrupt the value rankings, so each fetched row carries a `channel` of
`Pickup` or `Delivery` and the site's **Order type** filter defaults to pickup. Hand-curated
rows have no channel and are treated as counter prices.

### Re-running is safe

Each fetched row carries a `generatedBy` key. Re-running a brand replaces exactly its own
previous rows and leaves hand-curated rows alone, so a second run with the same location is
a no-op. Manual rows are only retired where the live feed carries an item of the same name;
pass `--keep-manual` to retire none of them.

### Chains with no reachable API

KFC, Hungry Jack's, Subway, Domino's and Grill'd are absent from the fetcher because none
exposes a menu that can be read directly from the chain without authentication:

- **KFC AU** — the My Carl's-style app runs on a gated Cognizant OrderServe backend; the
  ordering base URL is fetched at runtime and `api.kfc.com.au` returns 403.
- **Hungry Jack's** — the store list is open, but the menu route requires AWS SigV4 request
  signing with credentials from the app.
- **Grill'd** — `order.grilld.com.au` is a single-page app with no reachable public menu JSON.
- **Subway AU** — `order.subway.com` serves price and kJ together, but Akamai fingerprints
  the TLS handshake, so it needs a real browser rather than plain HTTP.
- **Domino's AU** — a private GraphQL backend behind Akamai, and prices are set per
  franchisee so no national price list exists to fetch. `scripts/update_pizza_kj.py` already
  scrapes what is available (kJ from the unprotected marketing site).

These stay hand-curated. Note that all five APIs that *are* used are undocumented and
unversioned: they can change or start requiring auth without notice, so treat a failed run
as "re-probe the endpoint", not "fix the script".

## Updating prices and food items

### Personal/local update

1. Open the website.
2. Click `Edit` on any item, or use `Add a food item`.
3. Save the item.
4. Your changes are stored in your browser only.

### Public GitHub Pages update

1. Edit items in the website.
2. Click `Export JSON`.
3. Replace `data/foods.json` with the exported file.
4. Commit and push to GitHub.
5. GitHub Pages deploys automatically through `.github/workflows/pages.yml`.

Example commands after replacing `data/foods.json`:

```bash
git add data/foods.json
git commit -m "Update fast food pricing data"
git push
```

## Deploying to GitHub Pages

This repo is configured for:

```text
https://skermiebrotech.github.io/fast-food-value-au/
```

1. Push this folder to `github.com/skermiebroTech/fast-food-value-au`.
2. In GitHub, go to `Settings` → `Pages`.
3. Under `Build and deployment`, choose `GitHub Actions`.
4. Push to `main`. The included workflow deploys the static files.

If you prefer the older Pages mode, choose `Deploy from a branch`, branch `main`, folder `/root`. The site also works that way because all assets are static.

## Data shape

`data/foods.json` contains:

```json
{
  "metadata": { "country": "Australia", "currency": "AUD" },
  "items": [
    {
      "id": "mcdonalds-cheeseburger",
      "brand": "McDonald's",
      "item": "Cheeseburger",
      "category": "Burger",
      "note": "",
      "price": 4.3,
      "serveGrams": 114,
      "energyKj": 1290,
      "energyCal": 308.32,
      "proteinGrams": 16,
      "sourceFile": "McDonalds_AU_Best_Value.xlsx"
    }
  ]
}
```

Rows produced by `scripts/fetch_menus.py` carry four extra keys:

```json
{
  "channel": "Pickup",
  "storeLabel": "Red Rooster Queens Plaza (Brisbane City QLD 4000)",
  "plu": "1012151-1",
  "generatedBy": "scripts/fetch_menus.py:rr"
}
```

Per-dollar metrics are calculated client-side from these values. A `price` of `null` means
no price is published for that item and renders as `—` rather than `$0.00`; a `null`
`energyKj` means the chain does not publish energy for that item.

## Price caveat

Australian fast food prices vary by store, franchise, app, delivery channel, time and promotion. Treat the seed data as a starting guide and update it for your local stores when accuracy matters.

Live-fetched rows narrow this but do not remove it: they are one Queensland store's prices at
one moment. Prices differ across Queensland — on Red Rooster, 53 of 85 shared items are priced
differently across five QLD stores, with regional stores consistently dearer than the south-east.
Re-run the fetcher with your own postcode rather than assuming the committed data matches your
local store.
