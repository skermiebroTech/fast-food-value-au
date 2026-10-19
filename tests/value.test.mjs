// Run from the repo root: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  itemKind, isBundle, deriveRow, deriveRows, rank, coverage, dedupe, normaliseItem, applyOverlay,
  exportItem, matchesSearch, searchTokens, KJ_PER_CAL
} from '../lib/value.js';

test('food-only classification keeps dishes and drops drinks, sauces, add-ons', () => {
  const cases = [
    ['Tuna Mayo (I) (Footlong Regular Sub)', 'Subs', 'food'],
    ['Original Pepper Mayo Slider', 'SNACK HACKS', 'food'],
    ['8 Wicked Boneless & Wicked Sauce', 'FOMO WOW', 'food'],
    ['Crispy Wings with O Sauce', 'NEW Ó RANGE', 'food'],
    ['3 x Tenders with Ketchup', 'Sides', 'food'],
    ['Sautéed Vegetable Burrito With Guacamole', 'Mains', 'food'],
    ['Triple Dippers With Spud Bites', 'Triple Dippers', 'food'],
    ['Hot Choc Fudge Brownies', 'Dessert', 'food'],
    ['Vanilla Bean Ice Cream 500ML', 'Cold Desserts', 'food'],
    ['$5 Large Chips & Kwench - Regular', 'FOMO WOW', 'food'],
    ['Soft Serve Cone', 'Desserts', 'food'],
    ['Large Latte', 'Menu', 'drink'],
    ['Lrg Flat White', 'Café Hola!', 'drink'],
    ['Coca-Cola® Classic 375ml', 'Cans', 'drink'],
    ['Chocolate Krunch Shake', 'NEW KWENCH BY KFC', 'drink'],
    ['Watermelon Boba Refresher', 'NEW KWENCH BY KFC', 'drink'],
    ['Medium Frozen Coke®', 'Loose Change Menu', 'drink'],
    ["Jack'd Up Energy Wicked Watermelon^", 'Burgers', 'drink'],
    ['Aioli Dip', 'SIDES & DESSERTS', 'sauce'],
    ['Creamy Garlic Aioli', 'Side', 'sauce'],
    ['Side of Chipotle Mayo', 'Sides', 'sauce'],
    ['Tomato Sauce', 'Sauces', 'sauce'],
    ['Large Solo ADD ON', 'FOMO WOW', 'drink'],
    ['Pickle Sauce ADD ON', 'FOMO WOW', 'sauce'],
    ['Regular Gravy ADD ON', 'FOMO WOW', 'sauce'],
    ['Regular Potato & Gravy ADD ON', 'FOMO WOW', 'addon'],
    ['1 Piece Original Recipe ADD ON', 'FOMO WOW', 'addon'],
    ['ADD 2 Large Sides for $7.95', 'FOMO WOW', 'addon'],
    ['Royale Chicken Patty', 'Menu', 'addon'],
    ['Sausage Patty (Beef & Pork)', 'Menu', 'addon'],
    ['Cheese Slice', 'Menu', 'addon'],
    ['Bacon Deluxe™', 'Menu', 'food'],
    ['Bacon & Egg on Turkish', 'Menu', 'food'],
    ['2x Vanilla Syrup', 'Menu', 'sauce'],
    ['Chocolate Topping', 'Menu', 'sauce'],
    ['OREO®', 'Menu', 'sauce'],
    ['Oreo Storm', 'Menu', 'food'],
    ['Hotcakes with Butter & Syrup', 'Extended Breakfast', 'food'],
    ['Apple Crumble Muffin', 'McCafe Food', 'food'],
    ['Ranch', 'Menu', 'sauce'],
    ['Blue Lagoon with Creamer', 'Menu', 'drink'],
    ['Large Raspberry', 'Menu', 'drink'],
    ['Med Earl Grey', 'Café Hola!', 'drink'],
    ['2 Cans Drink Bundle', 'Share Meals', 'drink'],
    ['WINGS & DRINK COMBO: $9.95 PICK UP | $11.95 DELIVERY', 'WingStreet Specials', 'food'],
    ['$1 KFC Youth Foundation Donation', 'CHARITY DONATIONS', 'other'],
    ['DoorDash Delivery Fee', 'Menu', 'other'],
    ['4 Large Pizzas + 2 Sides from $44.00 Pick Up or Delivery ($6.00 Delivery Fee)', 'Deals', 'food'],
    ['Kids Toy', 'Menu', 'other']
  ];
  for (const [name, cat, kind] of cases) assert.equal(itemKind(name, cat), kind, `${name} (${cat})`);
});

test('bundled deals are recognised across chains’ naming', () => {
  for (const [name, cat] of [
    ['Original Recipe Box', 'BOXED MEALS'], ['Giant Feast', 'SHARED MEALS'], ['Quarter Pack', 'Box Meals'],
    ['Bondi Box', 'Meal Boxes'], ['Family Pack', 'Share Meals'], ["Macca's Bundle For 2", 'Bundle Meals & Sharing'],
    ['Any 3 Pizzas', 'Deals'], ['$9.95 Wicked Double Deal', 'FOMO WOW'], ['Zinger® Pop Combo - Regular', 'FOMO WOW'],
    ['Footy Feed - Regular', 'FEATURED OFFERS'], ['Happy Meal Cheeseburger', 'Happy Meals']
  ]) assert.ok(isBundle(name, cat), `${name} (${cat})`);
  for (const [name, cat] of [
    ['Supreme (Family)', 'Pizza'], ['Chicken Nuggets 6 Pack', 'Chicken'], ["Chicken 'n' Cheese", 'Snacks & Sides'],
    ['Bacon & Egg McMuffin', 'McMuffins'], ['Cheese Lovers (Large)', 'Two for One Tuesday Pizza']
  ]) assert.ok(!isBundle(name, cat), `${name} (${cat})`);
});

test('energy is converted between kJ and Calories and flagged', () => {
  const calOnly = deriveRow({ id: 'a', brand: 'X', item: 'A', category: 'Burgers', price: 5, energyCal: 500 });
  assert.equal(calOnly.kj, 500 * KJ_PER_CAL);
  assert.match(calOnly.sourced.kj, /Calories/);
  const kjOnly = deriveRow({ id: 'b', brand: 'X', item: 'B', category: 'Burgers', price: 5, energyKj: 2092 });
  assert.equal(kjOnly.cal, 500);
  assert.equal(kjOnly.sourced.kj, undefined);
});

test('figures are borrowed only from the same item under the other order type', () => {
  const rows = deriveRows([
    { id: 'p', brand: 'X', item: 'Fritter', category: 'Snacks', price: 3, channel: 'Pickup' },
    { id: 'd', brand: 'X', item: 'Fritter', category: 'Snacks', price: 4, channel: 'Delivery', energyKj: 900, energyCal: 215 },
    // Same-order-type variants with different figures are distinct products: never borrowed.
    { id: 'v1', brand: 'X', item: 'Bundle', category: 'Deals', price: 20, channel: 'Pickup' },
    { id: 'v2', brand: 'X', item: 'Bundle', category: 'Deals', price: 20, channel: 'Pickup', energyKj: 2640 },
    { id: 'v3', brand: 'X', item: 'Bundle', category: 'Deals', price: 22, channel: 'Delivery', energyKj: 2640 },
    // Nothing anywhere: stays unknown.
    { id: 'n', brand: 'Y', item: 'Mystery', category: 'Mains', price: 9, channel: 'Pickup' }
  ]);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by.p.kj, 900);
  assert.equal(by.p.cal, 215);
  assert.match(by.p.sourced.kj, /delivery listing/);
  assert.equal(by.v1.kj, null);
  assert.equal(by.n.kj, null);
});

test('ranking keeps items without the figure out of the order but returns them', () => {
  const rows = deriveRows([
    { id: '1', brand: 'A', item: 'Big', category: 'Mains', price: 10, energyKj: 5000 },
    { id: '2', brand: 'A', item: 'Cheap', category: 'Mains', price: 2, energyKj: 2000 },
    { id: '3', brand: 'B', item: 'Unknown', category: 'Mains', price: 1 }
  ]);
  const { ranked, unranked } = rank(rows, 'kj');
  assert.deepEqual(ranked.map(r => r.id), ['2', '1']);
  assert.deepEqual(unranked.map(r => r.id), ['3']);
  assert.deepEqual(rank(rows, null).ranked.map(r => r.id), ['3', '2', '1']);
  const cov = coverage(rows, 'kj');
  assert.equal(cov.have, 2);
  assert.equal(cov.missing, 1);
  assert.deepEqual(cov.brands.map(b => [b.brand, b.have, b.total]), [['A', 2, 2], ['B', 0, 1]]);
});

test('identical listings collapse and search matches every word', () => {
  const rows = deriveRows([
    { id: '1', brand: 'KFC', item: 'Zinger Burger', category: 'Burgers', price: 9, energyKj: 2500, channel: 'Pickup' },
    { id: '2', brand: 'KFC', item: 'Zinger Burger', category: 'Burgers', price: 9, energyKj: 2500, channel: 'Pickup' },
    { id: '3', brand: 'KFC', item: 'Zinger Burger', category: 'Burgers', price: 11, energyKj: 2500, channel: 'Delivery' }
  ]);
  assert.equal(dedupe(rows).length, 2);
  assert.ok(matchesSearch(rows[0], searchTokens('kfc zinger')));
  assert.ok(!matchesSearch(rows[0], searchTokens('kfc whopper')));
});

test('edits overlay the published data and export keeps the fetcher schema', () => {
  const seed = [
    { id: 'a', brand: 'X', item: 'A', category: 'C', price: 5, plu: '11', generatedBy: 'scripts/fetch_menus.py:x', satFatGrams: 3 },
    { id: 'b', brand: 'X', item: 'B', category: 'C', price: 6 }
  ];
  const edited = normaliseItem({ ...seed[0], price: '5.5', energyKj: '1200', userEdited: true });
  assert.equal(edited.plu, '11');
  assert.equal(edited.generatedBy, 'scripts/fetch_menus.py:x');
  assert.equal(edited.satFatGrams, 3);
  assert.equal(edited.price, 5.5);
  const added = normaliseItem({ brand: 'Y', item: 'New', category: 'C', price: 3, userEdited: true });
  const state = { edits: { a: edited, [added.id]: added }, deleted: ['b'] };
  const merged = applyOverlay(seed, state);
  assert.deepEqual(merged.map(i => i.id), [added.id, 'a']);
  assert.equal(merged[1].price, 5.5);
  // A refreshed seed still shows through for untouched rows.
  const refreshed = applyOverlay([...seed, { id: 'c', brand: 'X', item: 'C', category: 'C', price: 7 }], state);
  assert.ok(refreshed.some(i => i.id === 'c'));
  assert.equal(exportItem(edited).userEdited, undefined);
  // An imported file replaces the base.
  assert.deepEqual(applyOverlay(seed, { imported: [{ id: 'z', price: 1 }] }).map(i => i.id), ['z']);
});

test('real data: every row classifies and derives without throwing', () => {
  const data = JSON.parse(readFileSync(new URL('../data/foods.json', import.meta.url)));
  const rows = deriveRows(data.items);
  assert.equal(rows.length, data.items.length);
  for (const r of rows) assert.ok(['food', 'drink', 'sauce', 'addon', 'other'].includes(r.kind));
  // kJ and Calories are always published together today, so conversion adds no figures …
  assert.equal(rows.filter(r => r.sourced.kj?.includes('Calories')).length, 0);
  // … and charity donations never count as the cheapest food.
  assert.ok(rows.filter(r => /donation/i.test(r.name)).every(r => r.kind === 'other'));
});
