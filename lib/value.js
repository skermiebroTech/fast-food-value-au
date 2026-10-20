// Pure value logic shared by the page and the Node tests: no DOM access here.

export const KJ_PER_CAL = 4.184;
// The reference adult intake Australian nutrition panels use for "% daily intake".
export const DAILY_KJ = 8700;

export const hasNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
// A positive figure or null. A zero price or zero kJ is treated as "not published".
export const pos = v => (hasNum(v) && Number(v) > 0 ? Number(v) : null);
export const round = (v, d = 2) => (hasNum(v) ? Number(Math.round(`${Number(v)}e${d}`) + `e-${d}`) : null);

// Ranking metrics. `field` is the per-serve figure on a derived row; value is field / price.
export const METRICS = {
  energy: { field: 'kj', name: 'Energy', noun: 'energy' },
  protein: { field: 'protein', name: 'Protein', noun: 'protein' },
  grams: { field: 'grams', name: 'Weight', noun: 'serve weight' },
  price: { field: null, name: 'Lowest price', noun: 'price' }
};

/* ---------- classification ---------- */

// What a row is, so rankings can stay about food you can actually order on its own.
//   other – charity donations, kids' toys, delivery fees; never ranked
//   drink / sauce – hidden by "Food only" (syrups, toppings and other flavourings count as sauce)
//   addon – only sold attached to another item; hidden by "Food only", and a combo needs a base item
//   food – everything else
const NOT_FOOD = /donation|charity|\btoys?\b/i;
// Only a line that *is* a fee: "4 Large Pizzas … ($6.00 Delivery Fee)" is a pizza deal.
const FEE = /\bfees?\s*$|surcharge/i;
const CAT_SAUCE = /sauce|\bdips?\b|condiment|dressing/i;
const CAT_DRINK = /drinks?\b|beverage|\bwater\b|juice|\bcans?\b|coffee|\bteas?\b|matcha|thickshake|smoothie/i;
const ADDON = /\badd[- ]?ons?\b|^add\b|^extra\b|\bupsize\b/i;
// Burger extras sold on their own line ("Beef Patty", "Cheese Slice") only go on top of a burger.
const EXTRA = /\bpatty\b(?!.*\b(burger|roll|wrap|meal|box)\b)|^(natural\s+)?cheese slice$|^(premium\s+)?(bacon|ham)$|^(cage-free\s+)?egg$|^(heavy\s+)?jalape[nñ]o$|^(turkish\s+)?bun$/i;
const TOPPING = /\b(syrup|toppings?|crumb|sprinkles|bursties)\b|^(\d+x\s*)?(vanilla|caramel|hazelnut|chocolate|strawberry|coconut|oreo|flake|biscoff)[®™]?$/i;
const DRINK_PACK = /\b(cans?|drinks?)\s+(drink\s+)?(bundle|pack)\b/i;
// A meal offer or a named dish is food even when its name mentions a drink or a dip.
const MEAL_WORD = /\b(combo|meal|deal|box|bucket|feast|snack|bundle|pack|platter)\b|\bfor \d\b/i;
const FOOD_WORD = /burger|slider|wrap|burrito|\bcali\b|taco|quesadilla|nachos?\b|\bbowl|pizza|\bsubs?\b|footlong|toastie|sandwich|\broll\b|fries|chips|tenders?\b|wings?\b|nuggets?|nuggs|popcorn|fillet|drumstick|chicken|brownies?|cookies?\b|cake|muffin|donut|doughnut|\bpie\b|sundae|\bcone\b|ice cream|mcflurry|croissant|bagel|hash brown/i;
// Joined names ("Chips & Pepsi", "Tenders with Ketchup") are dishes, not a drink or a dip alone.
const JOINED = /&|\+|,|\band\b|\bn'|'n\b|\bwith\b|\bw\//i;
const DRINK_NAME = new RegExp([
  'coffee', 'latte', 'cappuccino', '\\bcapp\\b', 'espresso', 'mocha', 'flat white', 'macchiato', 'piccolo',
  'long black', 'long back', 'short black', 'americano', '\\bchai\\b', '\\btea\\b', 'matcha', 'hot choc', 'iced choc',
  'babyccino', 'miniccino', 'shake\\b', 'frappe', 'smoothie', 'slush', '\\bspider\\b', 'frozen (coke|fanta|sprite|pepsi)',
  '\\bcoke\\b', 'coca-cola', 'pepsi', 'sprite', 'fanta', '\\bsolo\\b', 'sunkist', '\\b7 ?up\\b', 'mountain dew',
  'lemonade', '\\bjuice\\b', '\\bwater\\b', '\\bmilk\\b', 'soft drink', '\\bsoda\\b', 'energy drink', '\\bboba\\b',
  'refresher', 'kombucha', '\\benergy\\b', 'earl grey', 'creamer', 'lagoon', 'breeze', 'strawberry dream',
  '^(small|medium|large|regular) raspberry$', '\\d+(\\.\\d+)? ?(ml|l)\\b'
].join('|'), 'i');
const SAUCE_NAME = /(sauces?|\bdips?|mayo|aioli|gravy|ketchup|mustard|relish|dressing|salsa|guac(amole)?|sour cream|ranch)[\s^®™*]*$/i;

export function itemKind(name, category) {
  const n = String(name || ''), c = String(category || '');
  if (NOT_FOOD.test(c) || NOT_FOOD.test(n) || FEE.test(n)) return 'other';
  if (CAT_SAUCE.test(c)) return 'sauce';
  if (CAT_DRINK.test(c)) return 'drink';
  // "Regular Pepsi ADD ON" is still a drink and "Pickle Sauce ADD ON" still a sauce.
  if (ADDON.test(n)) {
    const kind = itemKind(n.replace(ADDON, ' ').trim(), '');
    return kind === 'food' ? 'addon' : kind;
  }
  if (EXTRA.test(n)) return 'addon';
  if (DRINK_PACK.test(n)) return 'drink';
  if (MEAL_WORD.test(n) || FOOD_WORD.test(n)) return 'food';
  if (DRINK_NAME.test(n)) return 'drink';
  if (TOPPING.test(n)) return 'sauce';
  if (JOINED.test(n)) return 'food';
  if (SAUCE_NAME.test(n)) return 'sauce';
  return 'food';
}

// Bundled deals (meal boxes, combos, sharing feasts). A combo may contain at most one.
const BUNDLE_CAT = /\bdeals?\b|\bmeals?\b|\bbox(es|ed)?\b|mydominosbox|bundle|\bshar(e|ed|ing)\b|feast|platter|catering|\bkids\b/i;
// "Family" (a pizza size), "6 Pack" (of nuggets) and "'n'" (Chicken 'n' Cheese) are single items.
const BUNDLE_NAME = /\b(meals?|combo|deal|box|boxed|boxfull|bundle|feast|feaster|feed|bucket|platter|party|dinner|lunch)\b|\bfor (\d|two|three|four|mates)\b/i;
export const isBundle = (name, category) => BUNDLE_CAT.test(String(category || '')) || BUNDLE_NAME.test(String(name || ''));

// Broad food type, used for the icon and the cross-chain "Type" filter.
export function foodType(name, category) {
  const s = `${name} ${category}`.toLowerCase();
  if (/coffee|latte|cappuccino|espresso|mocha|flat white|macchiato|piccolo|long black|matcha|\btea\b|chai|hot choc/.test(s)) return 'coffee';
  if (/thickshake|milkshake|\bshake\b|frappe/.test(s)) return 'shake';
  if (/coke|cola|sprite|fanta|pepsi|solo|mountain dew|7up|sunkist|soft drink|soda|\bwater\b|juice|\bmilk\b|energy drink|\bcans?\b|1\.25l|600ml|bottle|drink|lemonade|slush|spider|boba/.test(s)) return 'drink';
  if (/sundae|mcflurry|ice ?cream|soft serve|\bcone\b|storm|freeze|frozen/.test(s)) return 'icecream';
  if (/pizza|margherita|meatlover|meat lover|supreme|pepperoni|hawaiian/.test(s)) return 'pizza';
  if (/mcmuffin|brekky|breakfast|hotcake|hash brown|bacon & egg|sausage & egg|pancake/.test(s)) return 'breakfast';
  if (/burger|whopper|big mac|angus|cheeseburger|\bmac\b|\bjack\b|stunner|quarter pounder|mcfeast|slider/.test(s)) return 'burger';
  if (/nugget|nuggs|\bwing|tender|popcorn|strip|dipper|boneless/.test(s)) return 'nuggets';
  if (/chicken|zinger|twister|fillet|drumstick|rooster|parma|schnit|chook/.test(s)) return 'chicken';
  if (/wrap|burrito|rappa|wraptor|\broll\b|quesadilla|taco|nacho/.test(s)) return 'wrap';
  if (/\bsub\b|subs\b|sandwich|footlong|6 inch|6-inch|melt|toastie/.test(s)) return 'sub';
  if (/salad|\bbowl\b|veggie|greek|garden/.test(s)) return 'salad';
  if (/fries|chips|hash|onion ring|\bsides?\b|spud|garlic bread|breadstick/.test(s)) return 'fries';
  if (/sauce|\bdip\b|mayo|ketchup|mustard|aioli|gravy|condiment|dressing/.test(s)) return 'sauce';
  if (/pie|cookie|brownie|donut|doughnut|mousse|dessert|churro|muffin|cake|choc|sweet|slice|cheesecake/.test(s)) return 'dessert';
  return 'meal';
}

// The cross-chain "Type" filter groups the icon types into what people browse by.
export const TYPE_GROUPS = {
  burger: ['burger'], chicken: ['chicken', 'nuggets'], pizza: ['pizza'], wrap: ['wrap'], sub: ['sub'],
  salad: ['salad'], breakfast: ['breakfast'], sides: ['fries'], dessert: ['dessert', 'icecream']
};
export const matchesType = (row, type) => type === 'all' || (type === 'bundle' ? row.bundle : (TYPE_GROUPS[type] || []).includes(row.type));

/* ---------- derived rows ---------- */

export const channelOf = item => (String(item.channel || '').toLowerCase() === 'delivery' ? 'delivery' : 'pickup');
const nullableNum = v => (hasNum(v) ? Number(v) : null);

// One derived row per stored item. The stored item stays untouched (it is what gets exported);
// everything the page ranks on lives here.
export function deriveRow(src) {
  const name = String(src.item ?? '').trim() || 'Untitled item';
  const brand = String(src.brand ?? '').trim() || 'Other';
  const category = String(src.category ?? '').trim() || 'Other';
  const note = String(src.note ?? '');
  const kjPub = pos(src.energyKj), calPub = pos(src.energyCal);
  const row = {
    src, id: String(src.id ?? ''), brand, name, category, note, price: pos(src.price),
    channel: channelOf(src),
    kj: kjPub ?? (calPub ? calPub * KJ_PER_CAL : null),
    cal: calPub ?? (kjPub ? kjPub / KJ_PER_CAL : null),
    protein: pos(src.proteinGrams), grams: pos(src.serveGrams),
    satFat: nullableNum(src.satFatGrams), sugars: nullableNum(src.sugarsGrams), sodium: nullableNum(src.sodiumMg),
    kind: itemKind(name, category), bundle: isBundle(name, category), type: foodType(name, category),
    edited: Boolean(src.userEdited),
    // field -> how a figure that was not printed on this row was obtained
    sourced: {}
  };
  if (!kjPub && calPub) row.sourced.kj = 'converted from published Calories';
  if (kjPub && !calPub) row.sourced.cal = 'converted from published kJ';
  row.haystack = `${name} ${brand} ${category} ${note}`.toLowerCase();
  row.dupKey = [brand, name.toLowerCase(), row.channel, row.price, row.kj, row.protein].join('|');
  return row;
}

// Nutrition belongs to the product, not to how it is ordered. When a row has no figure, its own
// order type has no figure for that name either, and the same chain lists the same name under
// the other order type with exactly one published value, that value is used and flagged.
// Nothing is guessed from category averages.
const FILLABLE = ['kj', 'protein', 'grams'];
const OTHER_CHANNEL = { pickup: 'delivery', delivery: 'pickup' };
export function fillFromOtherChannel(rows) {
  const known = new Map(); // brand|name|field|channel -> Map(value -> donor row)
  const keyOf = (r, f, ch) => `${r.brand}|${r.name.toLowerCase()}|${f}|${ch}`;
  for (const r of rows) {
    for (const f of FILLABLE) {
      if (!r[f] || r.sourced[f]) continue;
      const k = keyOf(r, f, r.channel);
      if (!known.has(k)) known.set(k, new Map());
      known.get(k).set(r[f], r);
    }
  }
  let filled = 0;
  for (const r of rows) {
    for (const f of FILLABLE) {
      if (r[f] || known.has(keyOf(r, f, r.channel))) continue;
      const donors = known.get(keyOf(r, f, OTHER_CHANNEL[r.channel]));
      if (!donors || donors.size !== 1) continue;
      const [[value, from]] = donors;
      r[f] = value;
      r.sourced[f] = `from the ${from.channel} listing of the same item`;
      if (f === 'kj') { r.cal = from.cal; r.sourced.cal = r.sourced.kj; }
      filled += 1;
    }
  }
  return filled;
}

export function deriveRows(items) {
  const rows = items.map(deriveRow);
  fillFromOtherChannel(rows);
  return rows;
}

/* ---------- filtering, ranking, coverage ---------- */

export const perDollar = (row, field) => (row.price && row[field] ? row[field] / row.price : null);

// Identical listings (same chain, name, order type, price and figures) collapse to one.
export function dedupe(rows) {
  const seen = new Set();
  return rows.filter(r => (seen.has(r.dupKey) ? false : (seen.add(r.dupKey), true)));
}

// Search matches every word somewhere in the name, chain, category or note.
export const searchTokens = q => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
export const matchesSearch = (row, tokens) => tokens.every(t => row.haystack.includes(t));

const byPrice = (a, b) => a.price - b.price || a.name.localeCompare(b.name);

// Rows with the field are ranked by field per dollar; rows without it are returned separately so
// the page can say how many there are and list them, instead of dropping them silently.
// A null field ranks by lowest price.
export function rank(rows, field) {
  if (!field) return { ranked: [...rows].sort(byPrice), unranked: [] };
  const ranked = [], unranked = [];
  for (const r of rows) (r[field] ? ranked : unranked).push(r);
  ranked.sort((a, b) => b[field] / b.price - a[field] / a.price || byPrice(a, b));
  unranked.sort(byPrice);
  return { ranked, unranked };
}

export function coverage(rows, field) {
  const byBrand = new Map();
  let have = 0;
  for (const r of rows) {
    if (!byBrand.has(r.brand)) byBrand.set(r.brand, { brand: r.brand, total: 0, have: 0 });
    const b = byBrand.get(r.brand);
    b.total += 1;
    if (!field || r[field]) { b.have += 1; have += 1; }
  }
  const brands = [...byBrand.values()].sort((a, b) => a.brand.localeCompare(b.brand));
  return { total: rows.length, have, missing: rows.length - have, brands };
}

// Chains with at least one figure for the field: used to label a metric's real scope.
export const chainsWith = (rows, field) => [...new Set(rows.filter(r => r[field]).map(r => r.brand))].sort();

/* ---------- local edits ---------- */

const NUM_FIELDS = { price: 2, serveGrams: 1, energyKj: 2, energyCal: 2, proteinGrams: 1, satFatGrams: 1, sugarsGrams: 1, sodiumMg: 2, fibreGrams: 1 };
const slug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Shapes a hand-entered or imported item like a foods.json row. Keys it does not know about
// (plu, generatedBy, storeLabel…) are kept so an export round-trips the fetcher's schema.
export function normaliseItem(raw) {
  const it = { ...raw };
  it.brand = String(raw.brand ?? '').trim() || 'Other';
  it.item = String(raw.item ?? '').trim() || 'Untitled item';
  it.category = String(raw.category ?? '').trim() || 'Other';
  it.note = String(raw.note ?? '');
  for (const [k, d] of Object.entries(NUM_FIELDS)) if (k in raw || k === 'price') it[k] = round(raw[k], d);
  it.id = String(raw.id || '').trim() || `${slug(it.brand)}-${slug(it.item)}-${Date.now().toString(36)}`;
  return it;
}

// Local edits are an overlay on the published data, so a refreshed foods.json still shows
// through for every row the user has not touched.
//   state = { edits: { id: item }, deleted: [id], imported: null | [items] }
export function applyOverlay(seedItems, state) {
  const base = Array.isArray(state?.imported) ? state.imported : seedItems;
  const edits = state?.edits || {};
  const deleted = new Set(state?.deleted || []);
  const ids = new Set(base.map(i => i.id));
  const added = Object.values(edits).filter(i => !ids.has(i.id) && !deleted.has(i.id));
  return [...added, ...base.filter(i => !deleted.has(i.id)).map(i => edits[i.id] || i)];
}

// Export strips the page's own bookkeeping so the file matches the fetcher's schema.
export const exportItem = ({ userEdited, ...rest }) => rest;
