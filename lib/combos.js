// Exact best-combo search under a budget: a 0/1 knapsack over price, solved by dynamic programming.
//
// State = items so far (0..maxItems) × bundled deals used (0/1) × has a stand-alone item (add-ons
// need one) × total price in price units. Price units are the largest step every candidate price
// is a multiple of (usually 5c), so the table is exact and small. With at most four items per
// combo each state stores its item indices directly, so every combo is rebuilt exactly.
//
// Candidates: [{ price, value, bundle, addon }], value > 0. Each candidate is used at most once.

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const STATES = 4; // (bundles used) * 2 + (has a base item)
const VALID = [1, 3]; // finished combos need a base item

function solve(cands, budget, maxItems) {
  const cents = cands.map(c => Math.round(c.price * 100));
  const unit = cents.reduce(gcd, 0) || 1;
  const W = Math.floor((Math.round(budget * 100) + 1e-9) / unit);
  const val = [], picks = [], lo = [];
  for (let k = 0; k <= maxItems; k += 1) {
    val.push([]); picks.push([]); lo.push(new Array(STATES).fill(Infinity));
    for (let s = 0; s < STATES; s += 1) {
      val[k].push(new Float64Array(W + 1).fill(-Infinity));
      picks[k].push(new Int32Array((W + 1) * k));
    }
  }
  val[0][0][0] = 0; lo[0][0] = 0;

  cands.forEach((cand, i) => {
    const w = cents[i] / unit;
    if (w > W) return;
    const bundle = cand.bundle ? 1 : 0, base = cand.addon ? 0 : 1;
    // Higher counts first so this item is only ever added to combos built without it.
    for (let k = maxItems; k >= 1; k -= 1) {
      for (let sp = 0; sp < STATES; sp += 1) {
        if (lo[k - 1][sp] === Infinity) continue;
        const nb = (sp >> 1) + bundle;
        if (nb > 1) continue;
        const sn = nb * 2 + ((sp & 1) | base);
        const src = val[k - 1][sp], dst = val[k][sn], srcPicks = picks[k - 1][sp], dstPicks = picks[k][sn];
        const from = w + lo[k - 1][sp];
        for (let c = W; c >= from; c -= 1) {
          const prev = src[c - w];
          if (prev === -Infinity || prev + cand.value <= dst[c]) continue;
          dst[c] = prev + cand.value;
          const so = (c - w) * (k - 1), d = c * k;
          for (let j = 0; j < k - 1; j += 1) dstPicks[d + j] = srcPicks[so + j];
          dstPicks[d + k - 1] = i;
          if (c < lo[k][sn]) lo[k][sn] = c;
        }
      }
    }
  });
  return { val, picks, W, unit };
}

function combo(t, cands, k, s, c) {
  const items = Array.from(t.picks[k][s].subarray(c * k, c * k + k), i => cands[i]);
  return { items, value: t.val[k][s][c], price: Math.round(items.reduce((p, it) => p + it.price * 100, 0)) / 100 };
}

// Highest total value with between kMin and kMax items; ties go to the cheaper, then smaller combo.
function bestIn(t, cands, kMin, kMax) {
  let best = null;
  for (let c = 0; c <= t.W; c += 1) {
    for (let k = kMin; k <= kMax; k += 1) {
      for (const s of VALID) {
        const v = t.val[k][s][c];
        if (v > (best ? best.v : -Infinity)) best = { v, k, s, c };
      }
    }
  }
  return best && combo(t, cands, best.k, best.s, best.c);
}

// The cheapest combo that still reaches `share` of the best total.
function cheapestNear(t, cands, kMin, kMax, target, belowCost) {
  for (let c = 0; c < belowCost; c += 1) {
    let pick = null;
    for (let k = kMin; k <= kMax; k += 1) {
      for (const s of VALID) {
        const v = t.val[k][s][c];
        if (v >= target && v > (pick ? pick.v : -Infinity)) pick = { v, k, s };
      }
    }
    if (pick) return combo(t, cands, pick.k, pick.s, c);
  }
  return null;
}

// best: the highest-total combo of minItems..maxItems items within budget.
// bySize: the best combo at each exact item count.
// cheaper: the cheapest combo reaching `near` of the best total (null when the best is already it).
export function bestCombos(cands, { budget, maxItems = 3, minItems = 2, near = 0.9 } = {}) {
  if (!(budget > 0) || cands.length < minItems) return null;
  const t = solve(cands, budget, maxItems);
  const best = bestIn(t, cands, minItems, maxItems);
  if (!best) return null;
  const bySize = [];
  for (let k = minItems; k <= maxItems; k += 1) {
    const b = bestIn(t, cands, k, k);
    if (b) bySize.push(b);
  }
  const bestCost = Math.round(best.price * 100) / t.unit;
  const cheaper = cheapestNear(t, cands, minItems, maxItems, best.value * near, bestCost);
  return { best, bySize, cheaper };
}
