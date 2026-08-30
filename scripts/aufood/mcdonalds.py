"""McDonald's Australia (My Macca's).

The mobile app's backend at ``ap-prod.api.mcd.com`` is closed, but the APK
ships an OAuth client id and secret in ``assets/gma_markets_config.json`` and
the full endpoint map in ``assets/sdk_config_au_PROD_R7.json`` — extracted from
``com.mcdonalds.au.gma`` v26.61.2 in this repo under ``scripts/aufood/``.

Getting past Akamai Bot Manager requires an Android/browser TLS+H2 fingerprint,
so this fetcher uses ``curl_cffi`` (``pip install curl_cffi``) rather than the
shared ``net`` helper the other brands use.

Prices come per store from ``/exp/v1/menu/catalog/au/{NSN}``; each product row
carries three ``PriceTypeID`` values that map to ``Eat In / Take Out /
McDelivery`` — so pickup and delivery come from the same catalog fetch, no
second round-trip needed. Product names live in ``/exp/v1/market/configuration/au``
(one call per run, cached across every store) and category names live in
``/exp/v1/menu/au/category``.
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

try:
    from curl_cffi import requests as ccrequests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "curl_cffi is required for the McDonald's fetcher (needed to defeat "
        "Akamai Bot Manager's TLS/H2 fingerprinting). Install with: "
        "python3 -m pip install curl_cffi"
    ) from exc

from . import net
from .foods import make_row
from .stores import Store

BRAND = "McDonald's"
GENERATED_BY = "scripts/fetch_menus.py:mcdonalds"

BASE = "https://ap-prod.api.mcd.com"
IMPERSONATE = "chrome124"

# OAuth client credentials from the My Macca's APK. Kept out of git — the file
# is gitignored — so extract them locally with the recipe in the JSON's
# `_source` field, or set MCD_CLIENT_ID / MCD_CLIENT_SECRET environment
# variables to override.
CREDENTIALS_PATH = Path(__file__).with_name("mcd_credentials.json")


def _load_credentials() -> tuple[str, str]:
    env_id, env_secret = os.getenv("MCD_CLIENT_ID"), os.getenv("MCD_CLIENT_SECRET")
    if env_id and env_secret:
        return env_id, env_secret
    if not CREDENTIALS_PATH.exists():
        raise net.FetchError(
            f"McDonald's credentials missing. Create {CREDENTIALS_PATH} with "
            "{'clientId': '…', 'clientSecret': '…'} extracted from the My "
            "Macca's APK assets/gma_markets_config.json — or set MCD_CLIENT_ID "
            "and MCD_CLIENT_SECRET environment variables."
        )
    data = json.loads(CREDENTIALS_PATH.read_text())
    client_id = data.get("clientId")
    client_secret = data.get("clientSecret")
    if not client_id or not client_secret:
        raise net.FetchError(f"{CREDENTIALS_PATH} is missing clientId/clientSecret.")
    return client_id, client_secret


_credentials_cache: tuple[str, str] | None = None


def _credentials() -> tuple[str, str]:
    global _credentials_cache
    if _credentials_cache is None:
        _credentials_cache = _load_credentials()
    return _credentials_cache

USER_AGENT = "MCDSDK/22.0.32 (Android; 34; en-AU; Google Pixel 9a Build/CP2A.260805.005; 1.4)"

# PriceTypeID mapping per the app's ordering module — ID 1 is Eat In (dine-in),
# ID 2 is Take Out (pickup / takeaway), ID 3 is McDelivery. The app fetches one
# catalog and picks the price by pod, so we do the same.
PICKUP_PRICE_TYPE_ID = 2
DELIVERY_PRICE_TYPE_ID = 3
CHANNEL_PRICE_TYPE = {"Pickup": PICKUP_PRICE_TYPE_ID, "Delivery": DELIVERY_PRICE_TYPE_ID}

# QLD-only site. Sweep the major population centres with a wide radius and
# dedupe on NSN — restaurant/location returns a bounded result set per point.
QLD_SWEEP_POINTS = (
    (-27.4698, 153.0251),  # Brisbane City
    (-28.0167, 153.4000),  # Gold Coast
    (-26.6500, 153.0700),  # Sunshine Coast
    (-27.6389, 153.1067),  # Logan
    (-27.5606, 151.9539),  # Toowoomba
    (-25.2820, 152.8408),  # Hervey Bay
    (-23.3822, 150.5064),  # Rockhampton
    (-21.1400, 149.1900),  # Mackay
    (-19.2589, 146.8169),  # Townsville
    (-16.9186, 145.7781),  # Cairns
)
STORE_SWEEP_DISTANCE_M = 100_000  # 100 km around each point


_token_cache: str | None = None
_market_cache: dict | None = None
_names_cache: dict[int, str] | None = None
_categories_cache: dict[int, str] | None = None
_device_uuid = str(uuid.uuid4())


def _headers(token: str | None = None) -> dict:
    client_id, client_secret = _credentials()
    headers = {
        "mcd-marketid": "AU",
        "mcd-clientid": client_id,
        "mcd-clientsecret": client_secret,
        "mcd-uuid": _device_uuid,
        "mcd-sourceapp": "GMA",
        "mcd-devicePlatform": "android",
        "mcd-locale": "en-AU",
        "mcd-correlation-id": str(uuid.uuid4()),
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "en-AU",
    }
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


def _auth_token() -> str:
    global _token_cache
    if _token_cache:
        return _token_cache
    client_id, client_secret = _credentials()
    try:
        response = ccrequests.post(
            f"{BASE}/v1/security/auth/token",
            auth=(client_id, client_secret),
            data={"grantType": "client_credentials"},
            headers={**_headers(), "Content-Type": "application/x-www-form-urlencoded"},
            impersonate=IMPERSONATE,
            timeout=15,
        )
    except Exception as error:  # pragma: no cover - network flake
        raise net.FetchError(f"McDonald's auth request failed: {error}") from error
    if response.status_code != 200:
        raise net.FetchError(
            f"McDonald's auth returned HTTP {response.status_code}: {response.text[:200]}"
        )
    payload = response.json()
    token = (payload.get("response") or {}).get("token")
    if not token:
        raise net.FetchError(f"McDonald's auth response missing token: {payload}")
    _token_cache = token
    return token


def _get_json(url: str, params: dict | None = None, timeout: int = 30) -> Any:
    try:
        response = ccrequests.get(
            url,
            params=params,
            headers=_headers(_auth_token()),
            impersonate=IMPERSONATE,
            timeout=timeout,
        )
    except Exception as error:
        raise net.FetchError(f"{url} failed: {error}") from error
    if response.status_code != 200:
        raise net.FetchError(f"{url} returned HTTP {response.status_code}: {response.text[:200]}")
    return response.json()


def _market_config() -> dict:
    global _market_cache
    if _market_cache is None:
        _market_cache = _get_json(f"{BASE}/exp/v1/market/configuration/au").get("response", {})
    return _market_cache


def _names_map() -> dict[int, str]:
    """ProductCode -> display name, preferring longName."""
    global _names_cache
    if _names_cache is not None:
        return _names_cache
    out: dict[int, str] = {}
    for entry in _market_config().get("names", []):
        code = entry.get("ProductCode")
        if code is None:
            continue
        for name in entry.get("names", []):
            if name.get("languageId") == "en-AU":
                out[int(code)] = (name.get("longName") or name.get("name") or "").strip()
                break
    _names_cache = out
    return out


def _categories_map() -> dict[int, str]:
    """DisplayCategoryID -> category name from the market menu/category call."""
    global _categories_cache
    if _categories_cache is not None:
        return _categories_cache
    payload = _get_json(f"{BASE}/exp/v1/menu/au/category").get("response", {})
    out: dict[int, str] = {}
    for cat in payload.get("categories", []):
        cid = cat.get("id")
        if cid is None:
            continue
        for name in cat.get("names", []) or []:
            if name.get("locale") == "en-AU":
                out[int(cid)] = (name.get("longname") or name.get("shortname") or "").strip()
                break
    _categories_cache = out
    return out


def list_stores() -> list[Store]:
    """All AU/QLD stores gathered by sweeping the major population centres."""
    seen: dict[str, Store] = {}
    for latitude, longitude in QLD_SWEEP_POINTS:
        try:
            payload = _get_json(
                f"{BASE}/exp/v1/restaurant/location",
                params={
                    "filter": "search",
                    "latitude": latitude,
                    "longitude": longitude,
                    "distance": STORE_SWEEP_DISTANCE_M,
                },
            )
        except net.FetchError:
            continue
        for entry in payload.get("response", {}).get("restaurants", []) or []:
            nsn = str(entry.get("nationalStoreNumber") or "").strip()
            if not nsn or nsn in seen:
                continue
            location = entry.get("location") or {}
            store_lat, store_lon = location.get("latitude"), location.get("longitude")
            if store_lat is None or store_lon is None:
                continue
            address = entry.get("address") or {}
            state = (address.get("stateProvince") or "").strip()
            state_short = {
                "queensland": "QLD",
                "new south wales": "NSW",
                "victoria": "VIC",
                "south australia": "SA",
                "western australia": "WA",
                "tasmania": "TAS",
                "australian capital territory": "ACT",
                "northern territory": "NT",
            }.get(state.lower(), state.upper()[:3])
            seen[nsn] = Store(
                brand=BRAND,
                key=nsn,
                name=(entry.get("name") or "").strip(),
                suburb=(address.get("cityTown") or "").strip(),
                state=state_short,
                postcode=str(address.get("postalCode") or "").strip(),
                latitude=float(store_lat),
                longitude=float(store_lon),
                extra={"status": entry.get("restaurantStatus"), "gblNumber": entry.get("gblNumber")},
            )
    return list(seen.values())


def _price_for(prices: list[dict], price_type_id: int) -> float | None:
    for entry in prices or []:
        if (
            entry.get("PriceTypeID") == price_type_id
            and entry.get("IsValid")
            and entry.get("Price") is not None
        ):
            return float(entry["Price"])
    return None


# Categories in the menu tree that aren't a food deal — skip them so the site
# does not fill up with donation SKUs or synthetic "featured" rollups that
# duplicate items already priced in their real category.
CATEGORY_BLACKLIST = frozenset({
    "Support Ronald McDonald House",
    "Featured",
})


def _resolve_energy(product_map: dict[int, dict], code: int, depth: int = 0) -> float | None:
    """Return kJ for a product, walking the Recipe tree for combo meals.

    Combo Meal rows carry Energy=null and defer to their component products; a
    Big Breakfast meal only reports kJ once you add its recipe up. Choice
    ingredients whose ProductCode is a synthetic choice-group id (>= 10^7) are
    skipped — the drink+fry choice isn't fixed, so aggregating a specific
    solution would misrepresent the meal.
    """
    if depth > 4:
        return None
    product = product_map.get(code)
    if not product:
        return None
    direct = (product.get("Nutrition") or {}).get("Energy")
    if direct:
        return float(direct)

    recipe = product.get("Recipe") or {}
    total = 0.0
    for ingredient in recipe.get("Ingredients") or []:
        ing_code = ingredient.get("ProductCode")
        qty = ingredient.get("DefaultQuantity") or 1
        if ing_code is None:
            continue
        sub = _resolve_energy(product_map, int(ing_code), depth + 1)
        if sub:
            total += sub * qty
    return total if total > 0 else None


def fetch(store: Store, channel: str) -> list[dict]:
    """One row per (product, channel) for this store's catalog.

    Kept: products with a valid price AND a category the menu screen actually
    surfaces. That drops staff apparel, kitchen syrups, and choice-only items
    that show up in the raw catalog but aren't a sellable line the diner picks.
    Meal combos have their kJ aggregated from the Recipe's Ingredients where
    the underlying components have Energy.
    """
    price_type_id = CHANNEL_PRICE_TYPE[channel]
    payload = _get_json(f"{BASE}/exp/v1/menu/catalog/au/{store.key}", timeout=60)
    store_data = (payload.get("Store") or [{}])[0]
    products = store_data.get("Products") or []
    prices_by_code: dict[int, list[dict]] = {
        int(pp["ProductCode"]): pp.get("Prices") or []
        for pp in store_data.get("ProductPrice") or []
        if pp.get("ProductCode") is not None
    }
    product_map: dict[int, dict] = {
        int(p["ProductCode"]): p for p in products if p.get("ProductCode") is not None
    }

    names = _names_map()
    categories = _categories_map()
    source_file = (
        f"McDonald's AU menu API ({channel.lower()}, {store.suburb or store.name}) — "
        f"catalog for NSN {store.key}"
    )

    rows: list[dict] = []
    for product in products:
        if product.get("IsSalable") is False:
            continue
        code_raw = product.get("ProductCode")
        if code_raw is None:
            continue
        code = int(code_raw)
        price = _price_for(prices_by_code.get(code, []), price_type_id)
        if price is None or price <= 0:
            continue
        category = None
        for entry in product.get("Categories") or []:
            cid = entry.get("DisplayCategoryID")
            if cid and int(cid) in categories:
                category = categories[int(cid)].strip()
                break
        if not category or category in CATEGORY_BLACKLIST:
            continue
        name = (names.get(code) or "").strip()
        if not name:
            names_field = product.get("Names") or []
            if names_field and isinstance(names_field, list):
                name = (names_field[0].get("longName") or names_field[0].get("name") or "").strip()
        if not name:
            continue
        energy_kj = _resolve_energy(product_map, code)
        rows.append(
            make_row(
                brand=BRAND,
                item=name,
                category=category,
                price=price,
                energy_kj=energy_kj,
                note=f"{channel} price at {store.suburb or store.name}",
                channel=channel,
                store_label=store.label,
                plu=str(code),
                generated_by=GENERATED_BY,
                source_file=source_file,
                id_hint=f"{name}-{code}",
            )
        )
    return rows
