# AU Fast Food Value Finder

A modern, no-build GitHub Pages website for comparing Australian fast food value by:

- grams per dollar
- kilojoules per dollar
- calories per dollar
- protein grams per dollar
- budget-fit items under a user-entered AUD budget

Seed data was generated from:

- `/Users/joel/Downloads/Subway_AU_Best_Value.xlsx`
- `/Users/joel/Downloads/GYG_Best_Value.xlsx`
- `/Users/joel/Downloads/McDonalds_AU_Best_Value.xlsx`

The copied workbook sources are kept in `sources/` for maintainers. The browser loads the public seed dataset from `data/foods.json`.

## Features

- Static GitHub Pages compatible: no backend, no build step, no database.
- Responsive mobile cards and desktop comparison table.
- Search, brand/category filters, price cap, and metric-based sorting.
- Budget planner that finds best items under a selected budget.
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

1. Create a GitHub repo and push this folder.
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

Per-dollar metrics are calculated client-side from these values.

## Price caveat

Australian fast food prices vary by store, franchise, app, delivery channel, time and promotion. Treat the seed data as a starting guide and update it for your local stores when accuracy matters.
