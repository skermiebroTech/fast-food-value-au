"""Reading, writing and merging ``data/foods.json``.

Generated rows carry a ``generatedBy`` key naming the fetcher that produced
them. Re-running a fetcher replaces exactly its own previous rows and leaves
hand-curated rows alone, so the two sources can coexist in one file.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "data" / "foods.json"

KJ_PER_CAL = 4.184

# Extra keys generated rows carry beyond the original hand-curated schema.
GENERATED_KEYS = ("channel", "storeLabel", "plu", "generatedBy")


def slug(text: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(text or "").lower())) or "item"


def load(path: Path = DATA_PATH) -> dict:
    return json.loads(path.read_text())


def save(obj: dict, path: Path = DATA_PATH) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def clean_energy(kilojoules) -> float | None:
    """Treat a zero as "not published" - no food item is genuinely 0 kJ."""
    if kilojoules is None or float(kilojoules) <= 0:
        return None
    return float(kilojoules)


def kj_to_cal(kilojoules) -> float | None:
    if kilojoules is None:
        return None
    return round(float(kilojoules) / KJ_PER_CAL, 2)


def make_row(
    *,
    brand: str,
    item: str,
    category: str,
    price,
    generated_by: str,
    source_file: str,
    channel: str | None = None,
    store_label: str | None = None,
    plu: str | None = None,
    note: str = "",
    serve_grams=None,
    energy_kj=None,
    protein_grams=None,
    id_hint: str | None = None,
) -> dict:
    """Build one ``data/foods.json`` item in the shape the site already expects."""
    identifier = "-".join(
        part for part in (slug(brand), slug(channel) if channel else None, slug(id_hint or item)) if part
    )
    energy_kj = clean_energy(energy_kj)
    return {
        "id": identifier,
        "brand": brand,
        "item": item,
        "category": category or "Other",
        "note": note or "",
        "price": round(float(price), 2) if price is not None else None,
        "serveGrams": round(float(serve_grams), 1) if serve_grams is not None else None,
        "energyKj": round(float(energy_kj)) if energy_kj is not None else None,
        "energyCal": kj_to_cal(energy_kj),
        "proteinGrams": round(float(protein_grams), 1) if protein_grams is not None else None,
        "sourceFile": source_file,
        "channel": channel,
        "storeLabel": store_label,
        "plu": plu,
        "generatedBy": generated_by,
    }


def dedupe_ids(rows: list[dict]) -> list[dict]:
    """Make ids unique, keeping the first row that claimed each one."""
    seen: dict[str, int] = {}
    out = []
    for row in rows:
        base = row["id"]
        if base in seen:
            seen[base] += 1
            row = {**row, "id": f"{base}-{seen[base]}"}
        else:
            seen[base] = 1
        out.append(row)
    return out


def merge(obj: dict, rows: list[dict], generated_by: str, supersede=None) -> dict:
    """Replace this fetcher's previous output with ``rows``.

    ``supersede`` is an optional predicate over existing hand-curated rows; any
    row it matches is dropped. Use it when a live feed fully replaces a brand's
    manual entries.
    """
    kept = []
    replaced_generated = 0
    replaced_manual = 0
    for row in obj.get("items", []):
        if row.get("generatedBy") == generated_by:
            replaced_generated += 1
            continue
        if supersede and not row.get("generatedBy") and supersede(row):
            replaced_manual += 1
            continue
        kept.append(row)

    obj["items"] = dedupe_ids(kept + rows)
    return {
        "added": len(rows),
        "replacedGenerated": replaced_generated,
        "replacedManual": replaced_manual,
        "total": len(obj["items"]),
    }


def name_key(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())).strip()


def supersede_matching(brand: str, rows: list[dict], key_fn=name_key):
    """Predicate retiring only the manual rows the fetch actually replaced.

    Superseding a whole brand would delete items the API does not carry at the
    pinned store; matching on name keeps those and drops just the duplicates.
    """
    keys = {key_fn(row["item"]) for row in rows}
    keys.discard("")

    def predicate(row: dict) -> bool:
        return row.get("brand") == brand and key_fn(row.get("item")) in keys

    return predicate


def note_source(obj: dict, description: str) -> None:
    """Record a source line in ``metadata.generatedFrom`` without duplicating it."""
    generated = obj.setdefault("metadata", {}).setdefault("generatedFrom", [])
    if description not in generated:
        generated.append(description)
