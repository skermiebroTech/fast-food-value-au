"""Carl's Jr Australia.

The AU app backend is private and their Order Up! web tenancy is suspended, so
there is no price feed. What is open is a stock WordPress REST API on the
marketing site, and the menu page carries official energy values inline.

The REST endpoint returns the page with Divi shortcodes unexpanded, so items are
read out of ``[dsm_card title="..."] ... [/dsm_card]`` blocks rather than the
rendered ``dsm_card_title`` markup you see in a browser.

Prices stay manual: aggregator (Uber Eats / DoorDash) prices carry a delivery
markup and would skew a counter-price comparison.
"""
from __future__ import annotations

import html
import re

from . import net
from .foods import make_row

BRAND = "Carl's Jr"
GENERATED_BY = "scripts/fetch_menus.py:carlsjr"
MENU_PAGE_URL = "https://carlsjr.com.au/wp-json/wp/v2/pages?slug=our-menu"
DOWNLOADS_URL = "https://carlsjr.com.au/wp-json/wp/v2/dlm_download?per_page=100"

# WordPress applies smart quotes to shortcode attributes.
QUOTES = "\"'“”‘’"
TITLE_RE = re.compile(rf"\btitle=[{QUOTES}]([^{QUOTES}]+)[{QUOTES}]")
ENERGY_RE = re.compile(r"Energy\s*([\d,]+)\s*kj", re.IGNORECASE)


def _strip_tags(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _categorise(name: str) -> str:
    lowered = name.lower()
    if any(word in lowered for word in ("shake", "coke", "drink", "coffee", "juice")):
        return "Drinks"
    if any(word in lowered for word in ("fries", "onion rings", "tenders", "poppers", "sides", "nuggets")):
        return "Sides"
    if any(word in lowered for word in ("sundae", "dessert", "cookie", "pie")):
        return "Dessert"
    if "burger" in lowered or "star" in lowered or "angus" in lowered or "chicken" in lowered:
        return "Burgers"
    return "Menu"


def fetch() -> list[dict]:
    """Menu items with official kJ. Price is left unset - none is published."""
    pages = net.fetch_json(MENU_PAGE_URL)
    if not pages:
        return []
    content = html.unescape((pages[0].get("content") or {}).get("rendered") or "")

    rows: list[dict] = []
    seen: set[str] = set()
    for block in content.split("[dsm_card")[1:]:
        block = block.split("[/dsm_card")[0]
        header, _, body = block.partition("]")
        title_match = TITLE_RE.search(header)
        if not title_match:
            continue
        name = _strip_tags(html.unescape(title_match.group(1)))
        if not name or name.lower() in seen:
            continue

        energy_match = ENERGY_RE.search(body)
        if not energy_match:
            continue
        seen.add(name.lower())

        description = ""
        paragraphs = [_strip_tags(p) for p in re.findall(r"<p>(.*?)</p>", body, re.S)]
        for paragraph in paragraphs:
            if paragraph and not ENERGY_RE.search(paragraph) and not paragraph.startswith("["):
                description = paragraph
                break

        rows.append(
            make_row(
                brand=BRAND,
                item=name,
                category=_categorise(name),
                price=None,  # no published AU price source; add manually
                energy_kj=float(energy_match.group(1).replace(",", "")),
                note=(description[:150] + " · price not published — add manually").strip(" ·"),
                channel=None,
                store_label=None,
                plu=None,
                generated_by=GENERATED_BY,
                source_file="Carl's Jr AU menu page (WordPress REST API) — kJ only, no price",
                id_hint=name,
            )
        )
    return rows


def nutrition_pdfs() -> list[dict]:
    """Official PDFs published through the Download Monitor plugin, for reference."""
    try:
        downloads = net.fetch_json(DOWNLOADS_URL)
    except net.FetchError:
        return []
    return [
        {"id": entry.get("id"), "title": _strip_tags((entry.get("title") or {}).get("rendered") or ""),
         "link": entry.get("link")}
        for entry in downloads
    ]
