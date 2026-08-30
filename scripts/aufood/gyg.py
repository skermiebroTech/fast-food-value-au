"""Guzman y Gomez.

The ordering client's backend answers unauthenticated, but it is a price feed
only: just 57 of ~2,366 products carry ``nutritionalInfo`` and every main is
null. Energy therefore has to be joined on from the existing hand-curated GYG
rows (originally from the GYG allergen & nutrition guide) rather than taken
from the API.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from . import net
from .foods import make_row
from .stores import Store

BRAND = "GYG"
GENERATED_BY = "scripts/fetch_menus.py:gyg"
API_BASE = "https://api-external.prod.apps.gyg.com.au/prod"

# Menu ids from the ordering client: 1 = in-store/pickup, 4 = delivery.
PICKUP, DELIVERY = 1, 4
MENU_TYPE_CHANNEL = {PICKUP: "Pickup", DELIVERY: "Delivery"}


def list_stores() -> list[Store]:
    stores = []
    for entry in net.fetch_json(f"{API_BASE}/store"):
        latitude, longitude = entry.get("latitude"), entry.get("longitude")
        if latitude is None or longitude is None or entry.get("disableStoreOrder"):
            continue
        stores.append(
            Store(
                brand=BRAND,
                key=str(entry["id"]),  # the menu route keys on `id`, not `orderingId`
                name=(entry.get("name") or "").strip(),
                suburb=(entry.get("city") or "").strip(),
                state=(entry.get("state") or "").strip().upper(),
                postcode=str(entry.get("postCode") or "").strip(),
                latitude=float(latitude),
                longitude=float(longitude),
            )
        )
    return stores


def _walk_products(payload: dict):
    """Yield (section, subsection, category, product) across the menu tree."""
    for section in payload.get("sections") or []:
        for subsection in section.get("subSections") or []:
            for category in subsection.get("categories") or []:
                for product in category.get("products") or []:
                    yield section, subsection, category, product


def _energy_from_api(product: dict):
    """A handful of sides carry a bare kJ string; everything else is null."""
    info = product.get("nutritionalInfo")
    if not info:
        return None
    match = re.search(r"\d+", str(info))
    return float(match.group(0)) if match else None


# The menu is the cartesian product of filling x spice level, so "Burrito" ships
# as twelve rows. Spice does not change price, so those collapse to one.
SPICE_RE = re.compile(r"\s*\((mild|spicy)\)\s*$", re.IGNORECASE)

# Ordered longest-first so "Shredded Beef Brisket" wins over "Beef".
FILLINGS = (
    "shredded beef brisket",
    "pulled shiitake mushroom",
    "sauteed vegetables",
    "sauteed vegetable",
    "grilled chicken",
    "ground beef",
    "pulled pork",
    "tenders",
    "tender",
)

# The existing hand-curated rows follow the nutrition guide's convention of
# quoting the grilled chicken build wherever a filling choice exists.
STANDARD_FILLING = "grilled chicken"

# The API and the nutrition guide name several items differently.
ALIASES = {
    "burrito bowl": "bowl",
    "mini burrito bowl": "mini bowl",
    "caesar salad": "salad",
    "mini caesar salad": "mini salad",
    "queso cheese fries": "queso fries",
}


def _deaccent(text: str) -> str:
    normalised = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(ch for ch in normalised if not unicodedata.combining(ch))


def _strip_spice(name: str) -> str:
    return SPICE_RE.sub("", str(name or "")).strip()


def _split_filling(name: str) -> tuple[str | None, str]:
    """Separate the protein choice from the item.

    GYG is inconsistent about placement - "Grilled Chicken Burrito" but
    "Enchilada Grilled Chicken" - so both ends are checked.
    """
    plain = _strip_spice(name)
    lowered = _deaccent(plain).lower()
    for filling in FILLINGS:
        if lowered.startswith(filling + " "):
            return filling, plain[len(filling) + 1:].strip()
        if lowered.endswith(" " + filling):
            return filling, plain[: -(len(filling) + 1)].strip()
    return None, plain


def fetch(store: Store, menu_type: int) -> list[dict]:
    channel = MENU_TYPE_CHANNEL[menu_type]
    payload = net.fetch_json(f"{API_BASE}/menu/{menu_type}/{store.key}")
    source = f"GYG AU menu API ({channel.lower()}, {store.suburb or store.name}) — prices only"

    rows: list[dict] = []
    seen: set[str] = set()
    for section, subsection, category, product in _walk_products(payload):
        name = (product.get("name") or "").strip()
        price = product.get("price")
        if not name or price is None:
            continue
        display = _strip_spice(name)
        # Collapse the mild/spicy pair, and the same drink repeated per section.
        key = f"{display.lower()}|{price}"
        if key in seen:
            continue
        seen.add(key)
        label = (subsection.get("title") or category.get("name") or section.get("title") or "Other").strip()
        rows.append(
            make_row(
                brand=BRAND,
                item=display,
                category=label,
                price=price,
                energy_kj=_energy_from_api(product),
                note=f"{channel} price at {store.suburb or store.name}",
                channel=channel,
                store_label=store.label,
                plu=str(product.get("posPlu") or product.get("id") or ""),
                generated_by=GENERATED_BY,
                source_file=source,
                id_hint=display,
            )
        )
    return rows


def _match_key(name: str) -> str:
    text = re.sub(r"\([^)]*\)", " ", _deaccent(name).lower())
    text = text.replace("&", " and ").replace("'", "").replace("’", "")
    text = re.sub(r"\bwith guacamole\b", " ", text)
    text = re.sub(r"\b(sml|small|lrg|large|reg|regular|med|medium)\b", " ", text)
    key = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return ALIASES.get(key, key)


NUTRITION_PATH = Path(__file__).resolve().parents[2] / "data" / "gyg_nutrition.json"


def base_key(name: str) -> str:
    """Normalised item name with the protein choice removed, for joins."""
    return _match_key(_split_filling(name)[1])


def _nutrition_table(existing_items: list[dict]) -> dict[str, dict]:
    """Energy/serve/protein keyed by normalised item name.

    Read from the committed reference file, which is kept separate from
    ``foods.json`` precisely so that replacing GYG's rows with fetched ones
    cannot destroy the only copy of the nutrition data.
    """
    try:
        return json.loads(NUTRITION_PATH.read_text())["items"]
    except (OSError, ValueError, KeyError):
        pass
    table: dict[str, dict] = {}
    for item in existing_items:
        if item.get("brand") != BRAND or item.get("generatedBy"):
            continue
        key = _match_key(item.get("item"))
        if key and key not in table:
            table[key] = item
    return table


def attach_nutrition(rows: list[dict], existing_items: list[dict]) -> tuple[int, int]:
    """Carry serve/energy/protein from the hand-curated GYG rows onto API rows.

    The API supplies no usable energy data, so without this join every GYG row
    would drop out of the kJ- and protein-per-dollar rankings.

    Nutrition is only attached where the API item's filling is the one the
    nutrition guide row was actually built from - grilled chicken, or an item
    with no filling choice. Other fillings shift both weight and energy, so they
    keep their price and are left without energy rather than being given a
    number that was measured on a different build.

    Returns (matched, skipped_non_standard_filling).
    """
    table = _nutrition_table(existing_items)
    matched = 0
    skipped = 0
    for row in rows:
        filling, base = _split_filling(row["item"])
        if filling is not None and filling != STANDARD_FILLING:
            skipped += 1
            continue
        source = table.get(_match_key(base))
        if not source:
            continue
        if row.get("energyKj") is None and source.get("energyKj") is not None:
            row["energyKj"] = source["energyKj"]
            row["energyCal"] = source.get("energyCal")
        if source.get("serveGrams") is not None:
            row["serveGrams"] = source["serveGrams"]
        if source.get("proteinGrams") is not None:
            row["proteinGrams"] = source["proteinGrams"]
        row["sourceFile"] += " + GYG nutrition guide (via existing rows)"
        if filling == STANDARD_FILLING:
            row["note"] = (row["note"] + " · nutrition for the grilled chicken build").strip(" ·")
        matched += 1
    return matched, skipped
