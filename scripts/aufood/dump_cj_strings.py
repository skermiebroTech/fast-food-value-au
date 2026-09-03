"""Dump and search the string table from the My Carl's Hermes bundle."""
import re

from hermes_dec.parsers.hbc_file_parser import HBCReader

BUNDLE = "/private/tmp/claude-501/-Users-joel-fast-food-value-au/c7f73477-0972-4e04-8eaf-55ec4199721d/scratchpad/cj_apk/unzipped/assets/index.android.bundle"

r = HBCReader()
with open(BUNDLE, "rb") as f:
    r.read_whole_file(f)

print(f"strings: {len(r.strings)}, functions: {len(r.function_headers)}")
strings = [s for s in r.strings if s]

def show(label, matches):
    uniq = sorted(set(matches))
    print(f"\n=== {label}: {len(uniq)} unique ===")
    for m in uniq[:80]:
        print(f"  {m!r}")

show("contains 'menu'", [s for s in strings if re.search(r'\bmenu[/_]', s)])
show("contains 'auth'", [s for s in strings if re.search(r'\bauth[/_]', s)])
show("contains 'user'", [s for s in strings if re.search(r'\buser[/_]', s)])
show("contains 'store' or 'location'", [s for s in strings if re.search(r'\b(store|location)[/_]', s)])
show("contains 'session'", [s for s in strings if re.search(r'session', s, re.I) and len(s) < 60])
show("looks like a device/bootstrap path", [s for s in strings if re.search(r'/(device|guest|init|register|bootstrap|start|version|health|config)', s)])
show("possible static tokens (32-200 chars b64ish)", [
    s for s in strings
    if 32 <= len(s) <= 200 and re.fullmatch(r'[A-Za-z0-9_.:-]+', s)
])
show("headers", [s for s in strings if re.fullmatch(r'[Xx]-[A-Za-z-]{3,40}|Authorization|Cookie', s or "")])
