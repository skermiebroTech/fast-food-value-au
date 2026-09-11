"""Carl's Jr Australia, from the My Carl's app backend.

The AU app (``com.cjsales``) talks to an unauthenticated Node/Express API on
Azure that serves the whole national store list and, per store, the menu with
price and energy together. Three calls, no auth, no keys:

1. ``GET /sites`` -> every store as ``{siteId, siteName, state}``.
2. ``GET /menu/categories/{siteId}`` -> the store's categories.
3. ``GET /menu/items/category/{siteId}/{subMenuId}`` -> items, each carrying
   ``price`` (AUD, in-store) and ``calory`` (which is kilojoules, not calories).

This supersedes the old WordPress-page scrape, which gave kJ only and no price.

One wrinkle: ``/sites`` carries no coordinates, so - unlike every other brand -
Carl's cannot geocode its own stores. Nearest-store selection therefore leans on
a small Queensland centroid table (the site is QLD-scoped) with an optional
fallback to the pooled geocoder for anything outside it. The coordinates only
choose which store to quote; price and kJ come from the API by ``siteId``.
"""
from __future__ import annotations

import re

from . import net
from .foods import make_row
from .stores import Store

BRAND = "Carl's Jr"
GENERATED_BY = "scripts/fetch_menus.py:carlsjr"
API_BASE = "https://cjsales-api.azurewebsites.net"

# Suburb centroids for the Queensland stores. /sites gives no lat/long, so these
# exist only to pick the nearest QLD store; ~1 km accuracy is ample when the
# stores sit tens of km apart. Keyed by normalised siteName.
QLD_COORDS: dict[str, tuple[float, float]] = {
    "eagleby": (-27.6708, 153.2094),
    "fortitude valley": (-27.4558, 153.0351),
    "hope island": (-27.8709, 153.3553),
    "logan village": (-27.7704, 153.1028),
    "morayfield": (-27.1085, 152.9508),
    "redbank plains": (-27.6607, 152.8564),
    "riverview": (-27.6011, 152.8556),
    "rockhampton": (-23.3781, 150.5100),
    "slacks creek": (-27.6365, 153.1290),
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())).strip()


def _data(payload) -> list:
    """Unwrap the ``{"success": true, "data": [...]}`` envelope."""
    if isinstance(payload, dict) and payload.get("success"):
        data = payload.get("data")
        return data if isinstance(data, list) else []
    return []


def list_sites() -> list[dict]:
    """Raw national store list: ``{siteId, siteName, state}`` each."""
    return _data(net.fetch_json(f"{API_BASE}/sites"))


def list_stores(locate=None) -> list[Store]:
    """Every Carl's Jr store as a :class:`Store`.

    ``locate(name, state)`` is an optional fallback resolver returning
    ``(latitude, longitude)`` or ``None``; it fills coordinates for stores
    outside :data:`QLD_COORDS`. Stores that resolve to no point keep ``None``
    coordinates and are simply never the nearest store.
    """
    stores: list[Store] = []
    for site in list_sites():
        site_id = site.get("siteId")
        name = (site.get("siteName") or "").strip()
        state = (site.get("state") or "").strip().upper()
        if site_id is None or not name:
            continue

        point = QLD_COORDS.get(_norm(name))
        if point is None and locate is not None:
            point = locate(name, state)
        latitude, longitude = point if point else (None, None)

        stores.append(
            Store(
                brand=BRAND,
                key=str(site_id),
                name=name,
                suburb=name,
                state=state,
                postcode="",
                latitude=latitude,
                longitude=longitude,
            )
        )
    return stores


def menu_categories(site_id) -> list[dict]:
    return _data(net.fetch_json(f"{API_BASE}/menu/categories/{site_id}"))


def category_items(site_id, sub_menu_id) -> list[dict]:
    return _data(net.fetch_json(f"{API_BASE}/menu/items/category/{site_id}/{sub_menu_id}"))


def fetch(store: Store) -> list[dict]:
    """Every item for one store, with in-store price and kJ, deduped by item id.

    Carl's quotes a single counter price - there is no pickup/delivery split - so
    this emits one set of rows regardless of channel.
    """
    site_id = store.key
    source = f"Carl's Jr AU app API (in-store price + kJ, {store.suburb or store.name})"

    rows: list[dict] = []
    seen: set[str] = set()
    for category in menu_categories(site_id):
        category_name = (category.get("name") or "").strip() or "Menu"
        sub_menu_id = category.get("subMenuId")
        if sub_menu_id is None:
            continue
        for item in category_items(site_id, sub_menu_id):
            name = (item.get("name") or "").strip()
            price = item.get("price")
            if not name or price is None:
                continue
            item_id = str(item.get("menuItemId") or name)
            if item_id in seen:
                continue
            seen.add(item_id)
            rows.append(
                make_row(
                    brand=BRAND,
                    item=name,
                    category=category_name,
                    price=float(price),
                    energy_kj=item.get("calory"),  # misnamed field: this is kJ
                    note=f"In-store price at {store.suburb or store.name}"
                    + (" · combo" if item.get("comboId") else ""),
                    channel=None,
                    store_label=store.label,
                    plu=item_id,
                    generated_by=GENERATED_BY,
                    source_file=source,
                    id_hint=item_id,
                )
            )
    return rows
