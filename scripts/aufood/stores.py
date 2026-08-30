"""Location input and nearest-store resolution.

The site is scoped to Queensland, and every chain prices per store, so each run
has to answer "which store do we quote?". The user supplies a location and each
brand independently resolves its nearest QLD store to that point.

Geocoding is done against the chains' own store lists rather than an external
service: every brand publishes suburb, postcode and lat/long for each store, so
pooling them gives a serviceable AU suburb/postcode centroid table with no extra
dependency and no third-party API key.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Store:
    """One physical restaurant, normalised across the four store-list schemas."""

    brand: str
    key: str  # whatever that brand's menu endpoint is keyed by (code, slug, id)
    name: str
    suburb: str
    state: str
    postcode: str
    latitude: float
    longitude: float
    extra: dict = field(default_factory=dict, compare=False)

    @property
    def label(self) -> str:
        suburb = self.suburb or self.name
        return f"{self.name} ({suburb} {self.state} {self.postcode})".replace(" ()", "")


class LocationError(ValueError):
    """Raised when a location string cannot be resolved to a point."""


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def resolve_location(query: str, pool: list[Store], state: str | None = "QLD") -> tuple[float, float, str]:
    """Turn a user-supplied location into a (latitude, longitude, label) point.

    Accepts ``-27.47,153.02`` coordinates, a 4-digit postcode, or a suburb/town
    name. Postcode and suburb are matched against the pooled store lists.
    """
    raw = (query or "").strip()
    if not raw:
        raise LocationError("No location given.")

    coords = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*", raw)
    if coords:
        latitude, longitude = float(coords.group(1)), float(coords.group(2))
        return latitude, longitude, f"{latitude:.5f},{longitude:.5f}"

    # Prefer in-state matches so "Richmond" resolves to the QLD one, but fall
    # back to the national pool rather than failing outright.
    scoped = [s for s in pool if not state or (s.state or "").strip().upper() == state.upper()]
    for candidates in (scoped, pool):
        if not candidates:
            continue

        if re.fullmatch(r"\d{4}", raw):
            hits = [s for s in candidates if (s.postcode or "").strip() == raw]
            if hits:
                latitude, longitude = _centroid([(s.latitude, s.longitude) for s in hits])
                suburb = sorted({s.suburb for s in hits if s.suburb})
                label = f"postcode {raw}" + (f" ({', '.join(suburb[:3])})" if suburb else "")
                return latitude, longitude, label

        wanted = _normalise(raw)
        exact = [s for s in candidates if _normalise(s.suburb) == wanted or _normalise(s.name) == wanted]
        if exact:
            latitude, longitude = _centroid([(s.latitude, s.longitude) for s in exact])
            return latitude, longitude, f"{raw.title()} ({exact[0].state} {exact[0].postcode})"

        partial = [
            s for s in candidates
            if wanted and (wanted in _normalise(s.suburb) or wanted in _normalise(s.name))
        ]
        if partial:
            latitude, longitude = _centroid([(s.latitude, s.longitude) for s in partial])
            return latitude, longitude, f"{raw.title()} (nearest match: {partial[0].suburb or partial[0].name})"

    known = sorted({s.suburb for s in pool if s.suburb and (not state or s.state == state)})
    hint = ", ".join(known[:12])
    raise LocationError(
        f"Could not resolve location {raw!r}. Use a postcode (e.g. 4000), a "
        f"'lat,lng' pair, or a suburb served by one of the chains, e.g. {hint} ..."
    )


def nearest_store(stores: list[Store], latitude: float, longitude: float, state: str | None = "QLD") -> Store:
    """Closest store to a point, restricted to ``state`` when any exist there."""
    candidates = [s for s in stores if not state or (s.state or "").strip().upper() == state.upper()]
    if not candidates:
        candidates = stores
    if not candidates:
        raise LocationError("Brand returned no usable stores.")
    return min(candidates, key=lambda s: haversine_km(latitude, longitude, s.latitude, s.longitude))
