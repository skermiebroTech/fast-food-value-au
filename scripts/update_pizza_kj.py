#!/usr/bin/env python3
"""Refresh official AU pizza kJ values for Domino's and Pizza Hut.

Sources:
- Domino's AU nutritional-information page: per-slice kJ for Large Classic Crust pizzas.
- Pizza Hut AU product API used by /menu/pizza: total energy for Medium/Large pizzas.
"""
from __future__ import annotations

import html
import json
import re
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "foods.json"
DOMINOS_URL = "https://www.dominos.com.au/menu/nutritional-information/"
PIZZA_HUT_CONFIG = "https://discover.prod.pizzahutaustralia.com.au/api/v1/Configuration"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; fast-food-value-au-data-refresh/1.0)",
    "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    "Origin": "https://www.pizzahut.com.au",
    "Referer": "https://www.pizzahut.com.au/",
}

# Domino's nutrition page names do not always exactly match Frugal Feeds/menu names.
DOMINOS_OVERRIDES = {
    "garlic prawn": "garlic prawn imported seafood",
    "bbq chicken rasher bacon": "bbq chicken bacon",
    "vegan magherita": "vegan margherita",
    "cheesy garlic with creme fraiche": "cheesy garlic with creme fraiche",
}

PIZZA_HUT_SECONDARY_CATEGORIES = [
    "meatpizzas",
    "chickenpizzas",
    "prawnpizzas",
    "veggieandveganpizzas",
    "paneer-pizzas",
]


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)


def norm(value: str) -> str:
    value = html.unescape(value or "")
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = value.replace("&", " and ")
    value = value.replace("'n'", " n ")
    value = value.replace("’", "'").replace("'", "")
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\b(imported seafood|pizza|large|medium|classic crust)\b", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def item_base_name(item: str) -> str:
    return re.sub(r"\s*\([^)]*\)\s*", " ", item).strip()


def parse_dominos_large_pizza_kj() -> dict[str, float]:
    page = fetch_text(DOMINOS_URL)
    parts = re.split(r'(?=<div class="card" id="[^"]+-nutritional-info-product-card")', page)
    out: dict[str, float] = {}
    for part in parts[1:]:
        title_match = re.search(r'<div class="product-card-heading">(.*?)</div>', part, re.S)
        data_match = re.search(r'data-productservinginfo="([^"]*)"', part, re.S)
        if not title_match or not data_match:
            continue
        title = html.unescape(re.sub(r"<[^>]+>", " ", title_match.group(1))).strip()
        if not title:
            continue
        serving_inputs = re.findall(r"data-servinginfo='([^']+)'", part)
        servings = [json.loads(html.unescape(raw)) for raw in serving_inputs]
        classic = next((s for s in servings if s.get("Name") == "Classic Crust"), None)
        if not classic:
            continue
        # Map serving parameter IDs to their visible labels from the initially shown Classic Crust panel.
        label_by_param_id: dict[str, str] = {}
        for name, span_id in re.findall(
            r'class="serving-info-name">(.*?)</span>\s*<span class="serving-info-value"><span id="([^"]+)">',
            part,
            re.S,
        ):
            param_id = span_id.split("-serving-parameter-value-", 1)[-1]
            label_by_param_id[param_id] = html.unescape(re.sub(r"<[^>]+>", " ", name)).strip()
        rows = json.loads(html.unescape(data_match.group(1)))
        per_slice_kj = None
        for row in rows:
            if row.get("ServingId") != classic.get("Id"):
                continue
            if label_by_param_id.get(row.get("ServingParameterId")) == "Energy (kilojoules)":
                per_slice_kj = float(row["Value"])
                break
        if per_slice_kj is None:
            continue
        # Domino's footnote: kJ shown for pizza rows are based on Large Classic Crust.
        # Existing site rows use whole-large-pizza totals, so multiply the slice value by 8.
        out[norm(title)] = per_slice_kj * 8
    return out


def parse_pizza_hut_size_energy() -> dict[tuple[str, str], float]:
    config = fetch_json(PIZZA_HUT_CONFIG)
    product_root = config["uris"]["API_PRODUCT"]
    query_base = {
        "storeCode": "1080",  # Potts Point; nutrition is product-level, not store-specific.
        "fulfilmentDateTime": "2026-06-01T18:00",
        "fulfilmentType": "pickup",
        "includeIngredientDetails": "true",
        "cached": "true",
        "primaryCategory": "pizza",
    }
    out: dict[tuple[str, str], float] = {}
    for secondary in PIZZA_HUT_SECONDARY_CATEGORIES:
        query = {**query_base, "secondaryCategory": secondary}
        url = product_root + "/api/v1/product/products?" + urllib.parse.urlencode(query)
        data = fetch_json(url)
        for product in data.get("products", []):
            name_key = norm(product.get("name", ""))
            for size in product.get("sizes") or []:
                size_name = (size.get("name") or "").lower()
                energy = size.get("energy")
                if name_key and size_name in {"medium", "large"} and energy is not None:
                    out[(name_key, size_name)] = float(energy)
    return out


def update_metadata(obj: dict) -> None:
    metadata = obj["metadata"]
    generated = metadata.setdefault("generatedFrom", [])
    for source in [
        "Domino's AU nutritional information page (Large Classic crust kJ, June 2026)",
        "Pizza Hut AU menu product API (Medium/Large pizza kJ, June 2026)",
    ]:
        if source not in generated:
            generated.append(source)
    metadata["notes"] = (
        "Static seed data from provided Australia spreadsheets plus AU meal deals and expanded "
        "Domino's, Pizza Hut, Grill'd, and KFC AU rows. Official kJ values are attached where "
        "Domino's/Pizza Hut AU menu nutrition matched clearly; unmatched nutrition fields remain null. "
        "McSmart Meal rows use user-corrected Australian option/drink combinations and exclude McDouble. "
        "User edits are stored in localStorage and can be exported/imported as JSON."
    )
    metadata["audit"] = (
        "Expanded meal/deal coverage for Subway, GYG, McDonald's, KFC, Domino's, Pizza Hut, and Grill'd. "
        "Removed Subway FitChips, the $8 Footlong Sub of the Day promo, and invalid McDouble McSmart row. "
        "Domino's large-pizza kJ is included from the official AU nutrition page where item names matched "
        "Large Classic crust rows; Pizza Hut Medium/Large pizza kJ is included from the official menu product API "
        "where item names and sizes matched. Grill'd rows are price-only unless maintainers add nutrition later. "
        "Deal prices vary by store/app/campaign and should be checked against Australian store apps."
    )


def main() -> None:
    obj = json.loads(DATA_PATH.read_text())
    items = obj["items"]
    dominos_kj = parse_dominos_large_pizza_kj()
    pizza_hut_kj = parse_pizza_hut_size_energy()

    dominos_updates = []
    pizza_hut_updates = []
    for item in items:
        brand = item.get("brand")
        category = item.get("category")
        if brand == "Domino's" and category == "Pizza":
            base = norm(item_base_name(item.get("item", "")))
            source_key = DOMINOS_OVERRIDES.get(base, base)
            # Only attach to whole large/default pizzas. Do not infer Mini or Extra Large totals.
            label = item.get("item", "")
            if "Mini" in label or "Extra Large" in label:
                continue
            value = dominos_kj.get(source_key)
            if value is not None and item.get("energyKj") != value:
                item["energyKj"] = value
                item["energyCal"] = round(value / 4.184, 2)
                item["sourceFile"] = "Frugal Feeds Domino's prices + Domino's AU nutritional information (June 2026)"
                dominos_updates.append(item["item"])
        elif brand == "Pizza Hut" and category == "Pizza":
            match = re.match(r"^(.*?)\s*\((Medium|Large)\)", item.get("item", ""), re.I)
            if not match:
                continue
            name_key = norm(match.group(1))
            size_key = match.group(2).lower()
            value = pizza_hut_kj.get((name_key, size_key))
            if value is not None and item.get("energyKj") != value:
                item["energyKj"] = value
                item["energyCal"] = round(value / 4.184, 2)
                item["sourceFile"] = "Frugal Feeds Pizza Hut prices + Pizza Hut AU menu product API kJ (June 2026)"
                pizza_hut_updates.append(item["item"])

    update_metadata(obj)
    DATA_PATH.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({
        "dominos_source_entries": len(dominos_kj),
        "pizza_hut_source_size_entries": len(pizza_hut_kj),
        "dominos_rows_updated": len(dominos_updates),
        "pizza_hut_rows_updated": len(pizza_hut_updates),
        "dominos_updated_items": sorted(set(dominos_updates)),
        "pizza_hut_updated_items": sorted(set(pizza_hut_updates)),
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
