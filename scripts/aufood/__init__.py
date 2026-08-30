"""Live menu ingestion for the Australian fast food value site.

Each module in this package wraps one chain's public (but undocumented) ordering
API and emits rows in the ``data/foods.json`` shape. Standard library only, to
match the no-build nature of the repository.

Brand coverage:

===============  ==========================  =====================================
Module           Chain(s)                    What the API gives us
===============  ==========================  =====================================
``pizzahut``     Pizza Hut                   price + kJ
``craveable``    Red Rooster, Oporto         price + kJ (Oporto kJ ~54% populated)
``gyg``          Guzman y Gomez              price only
``carlsjr``      Carl's Jr                   kJ only
===============  ==========================  =====================================

Chains deliberately not covered here, because no reachable read API exists:
McDonald's (no JSON endpoint, Akamai), Hungry Jack's (menu behind AWS SigV4),
Subway (Akamai blocks non-browser clients), Domino's (Akamai + private GraphQL).
"""

__all__ = ["net", "stores", "foods", "pizzahut", "craveable", "gyg", "carlsjr"]
