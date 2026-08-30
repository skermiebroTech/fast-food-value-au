"""Pizza Hut Australia.

The SPA bootstraps from a discovery endpoint that hands out the service map, so
host names are resolved at run time rather than hardcoded. Nothing on the read
path needs auth; bearer tokens only appear once you actually order.

Uniquely among the chains here, each product size carries ``price`` and
``energy`` together, so this is the one feed that needs no separate kJ source.
"""
from __future__ import annotations

from . import net
from .foods import make_row
from .stores import Store

BRAND = "Pizza Hut"
GENERATED_BY = "scripts/fetch_menus.py:pizzahut"
DISCOVERY_URL = "https://discover.prod.pizzahutaustralia.com.au/api/v1/Configuration"

HEADERS = {"Origin": "https://www.pizzahut.com.au", "Referer": "https://www.pizzahut.com.au/"}

# Sizes named "Standard" are the only size, so folding them into the item name
# would just produce "Garlic Bread (Standard)".
UNNAMED_SIZES = {"standard", "regular", "", None}


def service_map() -> dict:
    return net.fetch_json(DISCOVERY_URL, headers=HEADERS)["uris"]


def list_stores(uris: dict | None = None) -> list[Store]:
    uris = uris or service_map()
    raw = net.fetch_json(f"{uris['API_STORE'].rstrip('/')}/api/v1/store", headers=HEADERS)
    stores = []
    for entry in raw:
        try:
            latitude = float(entry["latitude"])
            longitude = float(entry["longitude"])
        except (TypeError, ValueError, KeyError):
            continue
        stores.append(
            Store(
                brand=BRAND,
                key=str(entry.get("code") or entry.get("id")),
                name=(entry.get("name") or "").strip(),
                suburb=(entry.get("city") or "").strip(),
                # At least one record ships as "QLD " with a trailing space.
                state=(entry.get("state") or "").strip().upper(),
                postcode=str(entry.get("postCode") or "").strip(),
                latitude=latitude,
                longitude=longitude,
            )
        )
    return stores


def _category_pairs(uris: dict, store_code: str, when: str, fulfilment: str) -> list[tuple[str, str | None, str]]:
    """Every (primary, secondary, label) the products endpoint will accept.

    Products cannot be listed without a category, and categories with no
    children are queried with the primary code alone.
    """
    url = net.with_query(
        f"{uris['API_PRODUCT'].rstrip('/')}/api/v1/product/categories",
        {"storeCode": store_code, "fulfilmentDateTime": when, "fulfilmentType": fulfilment},
    )
    tree = net.fetch_json(url, headers=HEADERS).get("productCategories") or []
    pairs = []
    for parent in tree:
        children = parent.get("children") or []
        if not children:
            pairs.append((parent["code"], None, parent.get("name") or parent["code"]))
            continue
        for child in children:
            pairs.append((parent["code"], child["code"], child.get("name") or parent.get("name") or child["code"]))
    return pairs


def fetch(store: Store, fulfilment: str, when: str, uris: dict | None = None) -> list[dict]:
    """All products for one store and fulfilment type, one row per size."""
    uris = uris or service_map()
    product_root = uris["API_PRODUCT"].rstrip("/")
    channel = "Pickup" if fulfilment.lower() == "pickup" else "Delivery"
    source = f"Pizza Hut AU product API ({channel.lower()}, store {store.key})"

    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for primary, secondary, label in _category_pairs(uris, store.key, when, fulfilment):
        url = net.with_query(
            f"{product_root}/api/v1/product/products",
            {
                "storeCode": store.key,
                "fulfilmentDateTime": when,
                "fulfilmentType": fulfilment,
                "includeIngredientDetails": "false",
                "cached": "true",
                "primaryCategory": primary,
                "secondaryCategory": secondary,
            },
        )
        try:
            products = net.fetch_json(url, headers=HEADERS).get("products") or []
        except net.FetchError:
            # An empty or mistyped category pair 404s; other pairs are unaffected.
            continue

        for product in products:
            name = (product.get("name") or "").strip()
            if not name:
                continue
            for size in product.get("sizes") or []:
                size_name = (size.get("name") or "").strip()
                price = size.get("price")
                if price is None:
                    continue
                key = (str(product.get("productId") or name), size_name.lower())
                if key in seen:
                    continue
                seen.add(key)
                display = name if size_name.lower() in UNNAMED_SIZES else f"{name} ({size_name})"
                rows.append(
                    make_row(
                        brand=BRAND,
                        item=display,
                        category=label,
                        price=price,
                        energy_kj=size.get("energy"),
                        note=f"{channel} price at {store.suburb or store.name}",
                        channel=channel,
                        store_label=store.label,
                        plu=str(product.get("productId") or ""),
                        generated_by=GENERATED_BY,
                        source_file=source,
                        id_hint=f"{product.get('productId') or name}-{size_name or 'std'}",
                    )
                )
    return rows
