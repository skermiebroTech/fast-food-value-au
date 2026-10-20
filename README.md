# AU Fast Food Value Finder

Live URL:

https://skermiebrotech.github.io/fast-food-value-au/

A modern, no-build GitHub Pages website that finds the best-value Australian fast food:
the most food energy (kJ or Calories), protein or weight for each dollar, the most you can
get in one item for a budget, and the exact best 2–4 item meal under a budget.

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

- Static GitHub Pages compatible: no backend, no build step, no database. Plain files and
  native ES modules (`app.js` imports `lib/value.js` and `lib/combos.js`).
- **Compare**: rank by energy, protein or weight per dollar, or lowest price. Search, chain,
  food type, menu category, price cap, serving size and a "Food only" switch. Each metric shows
  which chains it can actually compare, and a coverage bar says how many matching items are
  ranked and how many have no published figure. Those items are listed rather than dropped.
- **Budget**: the one item with the most energy, protein or weight for a budget, or the best
  value per dollar under it.
- **Combos**: the exact best 2–4 item meal under a budget, at each chain, at one chain, or
  mixing chains. It also shows a cheaper combo that gets at least 90% as much, and the best
  combo at each item count.
- Order type (pickup or delivery) and energy unit (kJ or Cal) apply to every tab.
- Add, edit and delete items in the browser. Edits are stored in `localStorage` as an overlay
  on the published data, so refreshed prices still show for everything you haven't changed.
- Export a `foods.json` with the same schema as the fetcher output (including `plu`,
  `generatedBy`, `storeLabel` and `sourceNotes`), or import a file or pasted JSON.
- Mobile-first layout with a bottom tab bar on phones, light and dark themes (follows the
  system setting until you pick one), keyboard-navigable tabs, and labelled controls.
- Progressive Web App basics: `manifest.webmanifest`, network-first service worker with an
  offline fallback, SVG icon.
- GitHub Pages helpers: `.nojekyll`, `404.html`, `robots.txt`, `sitemap.xml`, and a Pages deployment workflow.

## How value is worked out

- Value is a figure divided by price: kJ (or Calories), grams of protein, or grams of food per
  dollar. It is a cost-of-food lens, not a health rating.
- **Only published figures are ranked.** About 42% of items have no published energy,
  including every Subway and Domino's item. Those items are counted in the coverage bar and
  listed under the ranking, never given an estimated figure. Two gaps are filled because the
  answer is exact: Calories ↔ kJ (1 Cal = 4.184 kJ), and an item with no figure takes it from
  the same chain's listing of the same item under the other order type, when that listing has
  exactly one value. Filled figures are marked.
- Protein is published only by KFC and GYG, and serve weight only by GYG, so those rankings
  say so and compare those chains only.
- **Food only** hides drinks (coffee and shakes included), sauces, dips and toppings, and
  add-ons that are only sold with another item. Charity donations, toys and delivery fees
  are never ranked. Identical listings are shown once.
- **Combos** are found with an exact dynamic program over price, not a shortlist. Each item is
  used at most once, a combo holds at most one bundled deal (meal box, combo, sharing feast),
  add-ons need a stand-alone item in the same combo, and drinks and sauces are left out.

## Tests

The value logic and the combo optimiser have Node tests (no dependencies). The combo tests
check the optimiser against brute-force enumeration on hundreds of random menus.

```bash
node --test
```

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
