"""Thin HTTP helpers shared by the brand fetchers.

These APIs are undocumented, so the two things that matter here are sending a
browser-shaped User-Agent (GYG's WAF 403s an empty one) and retrying transient
failures rather than losing a whole run to one blip.
"""
from __future__ import annotations

import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-AU,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}


class FetchError(RuntimeError):
    """Raised when a URL could not be retrieved after retries."""


def _decode(response) -> bytes:
    raw = response.read()
    encoding = (response.headers.get("Content-Encoding") or "").lower()
    if encoding == "gzip":
        return gzip.decompress(raw)
    if encoding == "deflate":
        return zlib.decompress(raw, -zlib.MAX_WBITS)
    return raw


def fetch_bytes(url: str, headers: dict | None = None, timeout: int = 60, retries: int = 3) -> bytes:
    request = urllib.request.Request(url, headers={**DEFAULT_HEADERS, **(headers or {})})
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return _decode(response)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last_error = error
            # 404 means "wrong category pair", not a flaky network - do not burn retries on it.
            if isinstance(error, urllib.error.HTTPError) and error.code in {400, 401, 403, 404}:
                break
            time.sleep(1.5 * (attempt + 1))
    raise FetchError(f"{url} failed: {last_error}") from last_error


def fetch_json(url: str, headers: dict | None = None, timeout: int = 60, retries: int = 3):
    payload = fetch_bytes(url, headers=headers, timeout=timeout, retries=retries)
    return json.loads(payload.decode("utf-8", "ignore"))


def fetch_text(url: str, headers: dict | None = None, timeout: int = 60, retries: int = 3) -> str:
    return fetch_bytes(url, headers=headers, timeout=timeout, retries=retries).decode("utf-8", "ignore")


def with_query(url: str, params: dict) -> str:
    clean = {key: value for key, value in params.items() if value is not None}
    return f"{url}?{urllib.parse.urlencode(clean)}"
