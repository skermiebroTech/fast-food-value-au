"""Red Rooster and Oporto, which share Craveable Brands' ``mobile-services``.

Both run the identical three-step flow, differing only by host and CDN:

1. ``content/menu/{slug}`` (needs ``x-api-key``) resolves per-channel menu URLs.
2. Those URLs are plain CloudFront JSON needing no headers at all.
3. A public store-sync JSON supplies the store list and slugs.

Prices are integer cents. The menu carries a literal ``HIDDEN`` category and a
tri-state ``visible`` flag (true / false / absent), both of which need filtering.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import net
from .foods import make_row
from .stores import Store

# The key is Craveable's to rotate, so it is re-read from the site bundle at run
# time; this value is only the fallback if that scrape stops working.
FALLBACK_API_KEY = "CfyDFmYWyua2LNM9oBx125eTVcMblZY28SjuNLdp"

PICKUP, DELIVERY = 2, 1
MENU_TYPE_CHANNEL = {PICKUP: "Pickup", DELIVERY: "Delivery"}


@dataclass(frozen=True)
class CraveableBrand:
    name: str
    code: str  # x-brand-code
    api_base: str
    store_sync_url: str
    website: str

    @property
    def generated_by(self) -> str:
        return f"scripts/fetch_menus.py:{self.code}"


RED_ROOSTER = CraveableBrand(
    name="Red Rooster",
    code="rr",
    api_base="https://apiv2.prd2.redrooster.com.au/mobile-services",
    store_sync_url="https://store-public.prd2.redrooster.com.au/rr_all_store_sync.json",
    website="https://www.redrooster.com.au",
)

OPORTO = CraveableBrand(
    name="Oporto",
    code="opo",
    api_base="https://api.oporto.com.au/mobile-services",
    store_sync_url="https://d3c377j0gjsips.cloudfront.net/opo_all_store_sync.json",
    website="https://www.oporto.com.au",
)

BRANDS = {"red-rooster": RED_ROOSTER, "oporto": OPORTO}


def _key_works(brand: CraveableBrand, api_key: str) -> bool:
    try:
        net.fetch_json(f"{brand.api_base}/content/menu/base-menu",
                       headers=_headers(brand, api_key), retries=1)
        return True
    except net.FetchError:
        return False


def _key_candidates(brand: CraveableBrand) -> list[str]:
    try:
        home = net.fetch_text(brand.website + "/", retries=2)
    except net.FetchError:
        return []
    match = re.search(r"/_next/static/chunks/pages/_app-[A-Za-z0-9]+\.js", home)
    if not match:
        return []
    try:
        bundle = net.fetch_text(brand.website + match.group(0), retries=2)
    except net.FetchError:
        return []
    # The bundle also holds same-length camelCase identifiers such as
    # "vaultInitiatedCheckoutPaymentMethodToken", so require a digit too.
    return [
        candidate for candidate in dict.fromkeys(re.findall(r'"([A-Za-z0-9]{40})"', bundle))
        if any(c.isdigit() for c in candidate)
        and any(c.islower() for c in candidate)
        and any(c.isupper() for c in candidate)
    ]


def discover_api_key(brand: CraveableBrand) -> str:
    """Read the client API key out of the Next.js bundle, verifying it before use.

    The key is Craveable's to rotate, so candidates are probed against a real
    endpoint rather than trusted on shape alone.
    """
    for candidate in _key_candidates(brand):
        if _key_works(brand, candidate):
            return candidate
    return FALLBACK_API_KEY


def _headers(brand: CraveableBrand, api_key: str) -> dict:
    return {"x-api-key": api_key, "x-brand-code": brand.code}


def list_stores(brand: CraveableBrand) -> list[Store]:
    payload = net.fetch_json(brand.store_sync_url)
    stores = []
    for entry in payload.get("data", []):
        attributes = entry.get("attributes") or {}
        relationships = entry.get("relationships") or {}
        components = (
            ((relationships.get("storeAddress") or {}).get("data") or {}).get("attributes", {}) or {}
        ).get("addressComponents") or {}
        slug = (((relationships.get("slug") or {}).get("data") or {}).get("attributes") or {}).get("slug")
        latitude = (components.get("latitude") or {}).get("value")
        longitude = (components.get("longitude") or {}).get("value")
        if not slug or latitude is None or longitude is None:
            continue
        if not attributes.get("isEnabledForTrading", True):
            continue
        stores.append(
            Store(
                brand=brand.name,
                key=slug,
                name=(attributes.get("storeName") or slug).strip(),
                suburb=((components.get("suburb") or {}).get("value") or "").strip(),
                state=((components.get("state") or {}).get("value") or "").strip().upper(),
                postcode=str((components.get("postcode") or {}).get("value") or "").strip(),
                latitude=float(latitude),
                longitude=float(longitude),
            )
        )
    return stores


def menu_urls(brand: CraveableBrand, store_slug: str, api_key: str) -> dict[int, str]:
    """Map menuType -> CDN menu URL for one store."""
    url = f"{brand.api_base}/content/menu/{store_slug}"
    payload = net.fetch_json(url, headers=_headers(brand, api_key))
    return {
        entry["menuType"]: entry["menuUrls"]
        for entry in payload.get("result", [])
        if entry.get("menuUrls") and entry.get("menuType") in MENU_TYPE_CHANNEL
    }


def fetch(brand: CraveableBrand, store: Store, menu_type: int, when: str, api_key: str | None = None) -> list[dict]:
    """All visible products for one store and channel, deduped by PLU."""
    api_key = api_key or discover_api_key(brand)
    urls = menu_urls(brand, store.key, api_key)
    if menu_type not in urls:
        return []

    channel = MENU_TYPE_CHANNEL[menu_type]
    payload = net.fetch_json(f"{urls[menu_type]}?dateTime={when}")
    source = f"{brand.name} AU menu API ({channel.lower()}, {store.suburb or store.name})"

    rows: list[dict] = []
    seen: set[str] = set()
    for category in payload.get("categories") or []:
        category_name = (category.get("name") or "").strip()
        if category_name.upper() == "HIDDEN":
            continue
        for product in category.get("products") or []:
            # Tri-state: only an explicit False hides a product.
            if product.get("visible") is False:
                continue
            name = (product.get("name") or "").strip()
            price_cents = product.get("price")
            if not name or price_cents is None:
                continue
            plu = str(product.get("plu") or name)
            if plu in seen:
                continue
            seen.add(plu)
            rows.append(
                make_row(
                    brand=brand.name,
                    item=name,
                    category=category_name or "Other",
                    price=float(price_cents) / 100.0,
                    energy_kj=product.get("kJ"),
                    note=f"{channel} price at {store.suburb or store.name}"
                    + (" · combo" if product.get("isCombo") else ""),
                    channel=channel,
                    store_label=store.label,
                    plu=plu,
                    generated_by=brand.generated_by,
                    source_file=source,
                    id_hint=plu,
                )
            )
    return rows
