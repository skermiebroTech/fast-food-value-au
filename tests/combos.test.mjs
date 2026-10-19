// Run from the repo root: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestCombos } from '../lib/combos.js';

// Small seeded PRNG so failures are reproducible.
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

// Every subset of 1..maxItems distinct candidates, filtered by the same rules the optimiser enforces.
function allCombos(cands, budget, maxItems, minItems) {
  const out = [];
  const budgetCents = Math.round(budget * 100);
  (function walk(start, picked, cents, value, bundles, base) {
    if (picked.length >= minItems && base) out.push({ picked: [...picked], cents, value });
    if (picked.length === maxItems) return;
    for (let i = start; i < cands.length; i += 1) {
      const c = cands[i];
      const nc = cents + Math.round(c.price * 100), nb = bundles + (c.bundle ? 1 : 0);
      if (nc > budgetCents || nb > 1) continue;
      picked.push(i); walk(i + 1, picked, nc, value + c.value, nb, base || !c.addon); picked.pop();
    }
  })(0, [], 0, 0, 0, false);
  return out;
}

function checkCombo(c, cands, { budget, maxItems, minItems }) {
  assert.ok(c.items.length >= minItems && c.items.length <= maxItems, 'item count in range');
  assert.equal(new Set(c.items).size, c.items.length, 'no item used twice');
  assert.ok(c.items.filter(i => i.bundle).length <= 1, 'at most one bundled deal');
  assert.ok(c.items.some(i => !i.addon), 'add-ons need a base item');
  assert.ok(c.price <= budget + 1e-9, 'within budget');
  const sum = c.items.reduce((s, i) => s + i.value, 0);
  assert.ok(Math.abs(sum - c.value) < 1e-6, 'value is the sum of its items');
  for (const i of c.items) assert.ok(cands.includes(i));
}

test('matches brute force on random menus', () => {
  const rand = rng(42);
  for (let trial = 0; trial < 300; trial += 1) {
    const n = 4 + Math.floor(rand() * 11);
    const cands = Array.from({ length: n }, (_, i) => ({
      id: i,
      price: (10 + Math.floor(rand() * 290)) * 5 / 100, // $0.50–$15 in 5c steps
      value: 100 + Math.floor(rand() * 5000),
      bundle: rand() < 0.25,
      addon: rand() < 0.2
    }));
    const opts = { budget: 3 + Math.floor(rand() * 30), maxItems: 2 + Math.floor(rand() * 3), minItems: 2 };
    const all = allCombos(cands, opts.budget, opts.maxItems, opts.minItems);
    const res = bestCombos(cands, opts);
    if (!all.length) { assert.equal(res, null, `trial ${trial}: nothing fits`); continue; }
    const bestValue = Math.max(...all.map(c => c.value));
    assert.ok(res, `trial ${trial}: found a combo`);
    checkCombo(res.best, cands, opts);
    assert.ok(Math.abs(res.best.value - bestValue) < 1e-6, `trial ${trial}: optimal total`);

    for (const b of res.bySize) {
      checkCombo(b, cands, opts);
      const sameSize = all.filter(c => c.picked.length === b.items.length);
      assert.ok(Math.abs(b.value - Math.max(...sameSize.map(c => c.value))) < 1e-6, `trial ${trial}: optimal at size ${b.items.length}`);
    }

    const target = bestValue * 0.9;
    const near = all.filter(c => c.value >= target);
    const minCents = Math.min(...near.map(c => c.cents));
    const bestCents = Math.round(res.best.price * 100);
    if (minCents < bestCents) {
      assert.ok(res.cheaper, `trial ${trial}: cheaper alternative exists`);
      checkCombo(res.cheaper, cands, opts);
      assert.equal(Math.round(res.cheaper.price * 100), minCents, `trial ${trial}: cheapest near-best`);
      assert.ok(res.cheaper.value >= target - 1e-6);
    } else {
      assert.equal(res.cheaper, null, `trial ${trial}: best is already the cheapest near-best`);
    }
  }
});

test('handles 1c price steps and large budgets', () => {
  const cands = [
    { price: 6.49, value: 3000, bundle: false, addon: false },
    { price: 6.99, value: 3400, bundle: false, addon: false },
    { price: 1.19, value: 10, bundle: false, addon: false },
    { price: 12.5, value: 9000, bundle: true, addon: false },
    { price: 11.45, value: 8800, bundle: true, addon: false }
  ];
  const res = bestCombos(cands, { budget: 25, maxItems: 3 });
  // Both deals together (17,800 for $23.95) break the one-deal rule, and the bigger deal plus the
  // two sides costs $25.98, so the best is the smaller deal plus both sides.
  assert.equal(res.best.value, 8800 + 3400 + 3000);
  assert.equal(res.best.price, 24.93);
});

test('add-ons alone never make a combo', () => {
  const cands = [
    { price: 2, value: 1200, bundle: false, addon: true },
    { price: 3, value: 1500, bundle: false, addon: true },
    { price: 9, value: 2000, bundle: false, addon: false }
  ];
  assert.equal(bestCombos(cands, { budget: 6, maxItems: 2 }), null);
  const res = bestCombos(cands, { budget: 14, maxItems: 3 });
  assert.equal(res.best.value, 4700);
});

test('returns null for no budget or too few items', () => {
  assert.equal(bestCombos([], { budget: 20 }), null);
  assert.equal(bestCombos([{ price: 1, value: 1 }], { budget: 0 }), null);
});
