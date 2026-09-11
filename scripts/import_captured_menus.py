#!/usr/bin/env python3
"""Import the four app-captured chain menus into ``data/foods.json``.

KFC, Subway, Domino's and Hungry Jack's have no unauthenticated read API, so
they cannot be refreshed by ``fetch_menus.py`` the way the other six chains are.
Their menus were read once from each chain's own app — KFC/Subway/Domino's from
the app's API traffic, Hungry Jack's from the app's on-disk menu cache — and the
parsed result is committed as a point-in-time snapshot in
``scripts/aufood/captures/``. This script loads those snapshots and merges them
into ``data/foods.json`` in the same row shape the live fetchers use.

    python3 scripts/import_captured_menus.py            # merge into data/foods.json
    python3 scripts/import_captured_menus.py --dry-run  # report only

These are still each restaurant's own data (not third-party), captured at one
Brisbane store per chain. Re-running replaces exactly these rows and leaves the
six live-fetched chains untouched.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aufood import foods  # noqa: E402

CAPTURES_DIR = Path(__file__).resolve().parent / "aufood" / "captures"


def slug(brand: str) -> str:
    return foods.slug(brand)


def generated_by(brand: str) -> str:
    return f"scripts/import_captured_menus.py:{slug(brand)}"


def rows_for(snapshot: dict) -> list[dict]:
    brand = snapshot["brand"]
    store = snapshot.get("store", "")
    channel = snapshot.get("channel") or None
    source = snapshot.get("source", f"{brand} app capture")
    captured = snapshot.get("capturedAt", "")
    gen = generated_by(brand)
    note_store = store or "in-store"

    rows = []
    for item in snapshot.get("items", []):
        rows.append(
            foods.make_row(
                brand=brand,
                item=item["item"],
                category=item.get("category") or "Menu",
                price=item.get("price"),
                energy_kj=item.get("energyKj"),
                note=f"{channel or 'In-store'} price at {note_store}"
                + (f" · captured {captured}" if captured else ""),
                channel=channel,
                store_label=store or None,
                plu=None,
                generated_by=gen,
                source_file=source,
                id_hint=item["item"],
            )
        )
    return rows


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing.")
    parser.add_argument("--data", type=Path, default=foods.DATA_PATH, help="Path to foods.json.")
    args = parser.parse_args(argv)

    snapshots = sorted(CAPTURES_DIR.glob("*.json"))
    if not snapshots:
        print(f"error: no snapshots in {CAPTURES_DIR}", file=sys.stderr)
        return 2

    obj = foods.load(args.data)
    summary = {}
    for path in snapshots:
        snapshot = json.loads(path.read_text())
        rows = rows_for(snapshot)
        with_kj = sum(1 for r in rows if r.get("energyKj"))
        result = foods.merge(obj, rows, generated_by(snapshot["brand"]))
        foods.note_source(obj, snapshot.get("source", snapshot["brand"]))
        summary[snapshot["brand"]] = {**result, "withKj": with_kj, "withPrice": len(rows)}
        print(f"{snapshot['brand']:14} {len(rows):>4} rows  ({len(rows)} priced, {with_kj} with kJ)  "
              f"[replaced {result['replacedGenerated']}]")

    obj.setdefault("metadata", {})["updated"] = "2026-09-11"
    print("\n" + json.dumps(summary, indent=2))
    if args.dry_run:
        print("\n(dry run — data/foods.json not written)")
        return 0
    foods.save(obj, args.data)
    print(f"\nWrote {args.data} — {len(obj['items'])} items total.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
