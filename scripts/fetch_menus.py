#!/usr/bin/env python3
"""Refresh ``data/foods.json`` from the Australian chains that expose a menu API.

Every one of these chains prices per store, so a location is required and each
brand resolves its own nearest Queensland store to that point.

    python3 scripts/fetch_menus.py --location 4000
    python3 scripts/fetch_menus.py --location "Surfers Paradise" --brands red-rooster,oporto
    python3 scripts/fetch_menus.py --location -27.47,153.02 --channels pickup --dry-run

Brands and what their API actually supplies:

    mcdonalds     price + kJ      supersedes the hand-entered McDonald's rows
                                  (needs curl_cffi for Akamai fingerprint bypass)
    pizza-hut     price + kJ      supersedes the hand-entered Pizza Hut rows
    red-rooster   price + kJ      new brand
    oporto        price + kJ      new brand; kJ present on only ~54% of items
    gyg           price only      kJ joined on from the existing GYG rows
    carls-jr      kJ only         new brand; price must be added manually

Hungry Jack's, Subway and Domino's are absent on purpose: none of them has a
reachable read API. See README for what each of them does expose.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aufood import carlsjr, craveable, foods, gyg, mcdonalds, net, pizzahut  # noqa: E402
from aufood.stores import LocationError, Store, haversine_km, nearest_store, resolve_location  # noqa: E402

STORE_BRANDS = ("pizza-hut", "red-rooster", "oporto", "gyg", "mcdonalds")
ALL_BRANDS = STORE_BRANDS + ("carls-jr",)


def reference_datetime() -> datetime:
    """A near-future trading time. Both APIs want a concrete fulfilment slot."""
    return (datetime.now() + timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)


def collect_stores(brand: str) -> list[Store]:
    if brand == "pizza-hut":
        return pizzahut.list_stores()
    if brand == "gyg":
        return gyg.list_stores()
    if brand == "mcdonalds":
        return mcdonalds.list_stores()
    if brand in craveable.BRANDS:
        return craveable.list_stores(craveable.BRANDS[brand])
    return []


def fetch_brand(brand: str, store: Store | None, channels: list[str], when: datetime) -> list[dict]:
    if brand == "carls-jr":
        return carlsjr.fetch()

    rows: list[dict] = []
    if brand == "pizza-hut":
        uris = pizzahut.service_map()
        stamp = when.strftime("%Y-%m-%dT%H:%M")
        for channel in channels:
            rows += pizzahut.fetch(store, "Pickup" if channel == "pickup" else "Delivery", stamp, uris=uris)
        return rows

    if brand in craveable.BRANDS:
        definition = craveable.BRANDS[brand]
        api_key = craveable.discover_api_key(definition)
        stamp = when.strftime("%Y%m%d%H%M")
        for channel in channels:
            menu_type = craveable.PICKUP if channel == "pickup" else craveable.DELIVERY
            rows += craveable.fetch(definition, store, menu_type, stamp, api_key=api_key)
        return rows

    if brand == "gyg":
        for channel in channels:
            menu_type = gyg.PICKUP if channel == "pickup" else gyg.DELIVERY
            rows += gyg.fetch(store, menu_type)
        return rows

    if brand == "mcdonalds":
        for channel in channels:
            rows += mcdonalds.fetch(store, "Pickup" if channel == "pickup" else "Delivery")
        return rows

    raise ValueError(f"Unknown brand {brand}")


# Store-agnostic: the store actually used is recorded under metadata.liveFetch,
# so these lines stay stable instead of accumulating one entry per location.
SOURCE_LABELS = {
    "pizza-hut": "Pizza Hut AU product API (live price + kJ)",
    "red-rooster": "Red Rooster AU menu API (live price + kJ)",
    "oporto": "Oporto AU menu API (live price + kJ, kJ incomplete)",
    "gyg": "GYG AU menu API (live price) + GYG nutrition guide for energy",
    "carls-jr": "Carl's Jr AU menu page WordPress REST API (kJ only, no price)",
    "mcdonalds": "My Macca's app API (live price + kJ)",
}


def generated_by(brand: str) -> str:
    return {
        "pizza-hut": pizzahut.GENERATED_BY,
        "gyg": gyg.GENERATED_BY,
        "carls-jr": carlsjr.GENERATED_BY,
        "red-rooster": craveable.RED_ROOSTER.generated_by,
        "oporto": craveable.OPORTO.generated_by,
        "mcdonalds": mcdonalds.GENERATED_BY,
    }[brand]


def supersede_predicate(brand: str, rows: list[dict], replace_manual: bool):
    """Retire the hand-entered rows a live fetch has genuinely replaced.

    Only Pizza Hut and GYG have pre-existing manual rows; the other three are
    new brands with nothing to supersede.
    """
    if not replace_manual or not rows:
        return None
    if brand == "pizza-hut":
        return foods.supersede_matching("Pizza Hut", rows)
    if brand == "gyg":
        return foods.supersede_matching("GYG", rows, key_fn=gyg.base_key)
    if brand == "mcdonalds":
        # The McDonald's API is the source of truth once we can reach it —
        # drop every hand-curated row, not just exact name matches, so retired
        # items like the old McSmart Meal do not linger.
        return lambda row: row.get("brand") == "McDonald's"
    return None


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--location", required=True,
                        help="Postcode (4000), suburb ('Surfers Paradise') or 'lat,lng'.")
    parser.add_argument("--brands", default=",".join(ALL_BRANDS),
                        help=f"Comma-separated subset of: {', '.join(ALL_BRANDS)}")
    parser.add_argument("--channels", default="pickup,delivery",
                        help="Comma-separated: pickup, delivery. Each becomes its own set of rows.")
    parser.add_argument("--state", default="QLD", help="Restrict store choice to this state (default QLD).")
    parser.add_argument("--keep-manual", action="store_true",
                        help="Keep every hand-entered row, even where the live feed replaces it "
                             "(affects Pizza Hut and GYG; the other brands are new).")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing.")
    parser.add_argument("--data", type=Path, default=foods.DATA_PATH, help="Path to foods.json.")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    brands = [b.strip() for b in args.brands.split(",") if b.strip()]
    channels = [c.strip().lower() for c in args.channels.split(",") if c.strip()]

    unknown = sorted(set(brands) - set(ALL_BRANDS)) + sorted(set(channels) - {"pickup", "delivery"})
    if unknown or not brands or not channels:
        print(f"error: unknown or empty brand/channel: {', '.join(unknown) or '(none given)'}\n"
              f"       brands:   {', '.join(ALL_BRANDS)}\n"
              f"       channels: pickup, delivery", file=sys.stderr)
        return 2

    when = reference_datetime()
    print(f"Reference fulfilment time: {when:%Y-%m-%d %H:%M}\n")

    # Store lists double as the geocoder, so gather them before resolving the
    # location - and gather all of them, not just the selected brands, so that
    # --brands does not shift the resolved point and change which store is
    # nearest.
    store_lists: dict[str, list[Store]] = {}
    for brand in STORE_BRANDS:
        try:
            store_lists[brand] = collect_stores(brand)
            in_state = sum(1 for s in store_lists[brand] if s.state == args.state.upper())
            print(f"  {brand:<12} {len(store_lists[brand]):>4} stores ({in_state} in {args.state.upper()})")
        except net.FetchError as error:
            print(f"  {brand:<12} store list unavailable: {error}", file=sys.stderr)

    pool = [store for stores in store_lists.values() for store in stores]
    if pool:
        try:
            latitude, longitude, label = resolve_location(args.location, pool, state=args.state)
        except LocationError as error:
            print(f"\nerror: {error}", file=sys.stderr)
            return 2
        print(f"\nLocation: {label} -> {latitude:.5f}, {longitude:.5f}\n")
    else:
        latitude = longitude = None
        label = args.location

    obj = foods.load(args.data)
    summary: dict[str, dict] = {}

    for brand in brands:
        store = None
        if brand in STORE_BRANDS:
            if brand not in store_lists:
                continue
            try:
                store = nearest_store(store_lists[brand], latitude, longitude, state=args.state)
            except LocationError as error:
                print(f"{brand}: {error}", file=sys.stderr)
                continue
            distance = haversine_km(latitude, longitude, store.latitude, store.longitude)
            print(f"{brand:<12} -> {store.label}  ({distance:.1f} km)")

        try:
            rows = fetch_brand(brand, store, channels, when)
        except net.FetchError as error:
            print(f"{brand:<12} !! fetch failed: {error}", file=sys.stderr)
            continue

        if brand == "gyg":
            joined, skipped = gyg.attach_nutrition(rows, obj["items"])
            print(f"{'':<12}    joined nutrition onto {joined}/{len(rows)} rows "
                  f"({skipped} skipped: filling differs from the guide's build)")

        with_kj = sum(1 for r in rows if r.get("energyKj"))
        with_price = sum(1 for r in rows if r.get("price"))
        print(f"{'':<12}    {len(rows)} rows  ({with_price} priced, {with_kj} with kJ)")

        result = foods.merge(obj, rows, generated_by(brand),
                             supersede=supersede_predicate(brand, rows, not args.keep_manual))
        foods.note_source(obj, SOURCE_LABELS[brand])
        summary[brand] = {**result, "store": store.label if store else None,
                          "withKj": with_kj, "withPrice": with_price}

    obj.setdefault("metadata", {})["updated"] = f"{datetime.now():%Y-%m-%d}"
    obj["metadata"]["liveFetch"] = {
        "location": label,
        "state": args.state.upper(),
        "channels": channels,
        "fetchedAt": f"{datetime.now():%Y-%m-%dT%H:%M:%S}",
        "stores": {brand: data["store"] for brand, data in summary.items() if data["store"]},
        "command": f"python3 scripts/fetch_menus.py --location {args.location!r}",
    }

    print("\n" + json.dumps(summary, indent=2))
    if args.dry_run:
        print("\n(dry run — data/foods.json not written)")
        return 0

    foods.save(obj, args.data)
    print(f"\nWrote {args.data} — {len(obj['items'])} items total.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
