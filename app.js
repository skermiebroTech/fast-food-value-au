const DATA_URL = 'data/foods.json';
const INGREDIENTS_URL = 'data/ingredients.json';
const STORAGE_KEY = 'au-fast-food-value.items.v8';
const UI_KEY = 'au-fast-food-value.ui.v1';
const THEME_KEY = 'au-fast-food-value.theme.v1';

const $ = sel => document.querySelector(sel);
const els = {
  dataChip: $('#dataChip'), themeToggle: $('#themeToggle'), tabs: $('#tabs'),
  introMeta: $('#introMeta'), podium: $('#podium'),
  search: $('#searchInput'), metric: $('#metricSelect'), brand: $('#brandFilter'),
  category: $('#categoryFilter'), channel: $('#channelFilter'), maxPrice: $('#maxPrice'),
  foodOnly: $('#foodOnly'), clearFilters: $('#clearFilters'), quickStats: $('#quickStats'),
  ranking: $('#ranking'), rankingEmpty: $('#rankingEmpty'), metricNote: $('#metricNote'),
  budget: $('#budgetInput'), budgetMetric: $('#budgetMetric'), budgetBrand: $('#budgetBrand'),
  budgetSummary: $('#budgetSummary'), budgetList: $('#budgetList'),
  comboBudget: $('#comboBudget'), comboBrand: $('#comboBrand'), comboSize: $('#comboSize'),
  comboMetric: $('#comboMetric'), comboSummary: $('#comboSummary'), comboList: $('#comboList'),
  form: $('#itemForm'), formTitle: $('#formTitle'), itemId: $('#itemId'), itemName: $('#itemName'),
  itemBrand: $('#itemBrand'), itemCategory: $('#itemCategory'), itemPrice: $('#itemPrice'),
  itemServe: $('#itemServe'), itemKj: $('#itemKj'), itemCal: $('#itemCal'), itemProtein: $('#itemProtein'),
  itemNote: $('#itemNote'), deleteItem: $('#deleteItem'), newItem: $('#newItem'),
  exportJson: $('#exportJson'), importText: $('#importText'), importJson: $('#importJson'),
  resetEdits: $('#resetEdits'), dataStatus: $('#dataStatus'),
  brandList: $('#brandList'), categoryList: $('#categoryList')
};

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const n0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });

// metric -> underlying nutrient field + display
const METRICS = {
  kjPerDollar:      { unit: 'kJ/$',  nutrient: 'energyKj',     fmt: n0 },
  calPerDollar:     { unit: 'Cal/$', nutrient: 'energyCal',    fmt: n0 },
  proteinPerDollar: { unit: 'g/$',   nutrient: 'proteinGrams', fmt: n1 },
  gramsPerDollar:   { unit: 'g/$',   nutrient: 'serveGrams',   fmt: n1 },
  price:            { unit: '',      nutrient: 'price',        fmt: money }
};
const BRAND_COLORS = {
  "McDonald's": '#c8102e', 'KFC': '#a3080f', 'Subway': '#0a7d34', 'GYG': '#d1180b',
  "Domino's": '#0b6cae', 'Pizza Hut': '#c8102e', 'Red Rooster': '#b4131f',
  'Oporto': '#c8102e', "Carl's Jr": '#b4131f', "Grill'd": '#4d7c3a'
};

let seed = { metadata: {}, items: [] };
let items = [];
let ingredients = {};
let editingId = null;

// Look up a chain+item's makeup. Falls back to the base name (strips a trailing
// "(Large)" etc.) so Domino's per-size rows match their per-product ingredients.
function itemInfo(brand, item) {
  const byBrand = ingredients[brand];
  if (!byBrand) return null;
  return byBrand[item] || byBrand[item.replace(/\s*\([^)]*\)\s*$/, '').trim()] || null;
}

const hasNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const asNum = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, d = 2) => (hasNum(v) ? Number(Math.round(`${Number(v)}e${d}`) + `e-${d}`) : null);
const fmtMoney = v => (hasNum(v) && Number(v) > 0 ? money.format(Number(v)) : '—');
const fmtNum = (v, f = n1, s = '') => (hasNum(v) && Number(v) > 0 ? `${f.format(Number(v))}${s}` : '—');
const slug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
const escapeHtml = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));

function withMetrics(item) {
  const price = asNum(item.price);
  return {
    ...item, price,
    gramsPerDollar: price && hasNum(item.serveGrams) ? asNum(item.serveGrams) / price : 0,
    kjPerDollar: price && hasNum(item.energyKj) ? asNum(item.energyKj) / price : 0,
    calPerDollar: price && hasNum(item.energyCal) ? asNum(item.energyCal) / price : 0,
    proteinPerDollar: price && hasNum(item.proteinGrams) ? asNum(item.proteinGrams) / price : 0
  };
}
function normaliseItem(item) {
  return {
    id: item.id || slug(`${item.brand}-${item.item}`), brand: item.brand || 'Other',
    item: item.item || 'Untitled item', category: item.category || 'Other', note: item.note || '',
    price: round(item.price) ?? 0, serveGrams: round(item.serveGrams, 1), energyKj: round(item.energyKj),
    energyCal: round(item.energyCal), proteinGrams: round(item.proteinGrams, 1),
    sourceFile: item.sourceFile || 'local', channel: item.channel || '', storeLabel: item.storeLabel || '',
    userEdited: Boolean(item.userEdited)
  };
}

/* ---------- persistence ---------- */
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ metadata: { ...seed.metadata, locallyEdited: new Date().toISOString() }, items }));
}
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } };
const loadUI = () => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } };
function saveUI() {
  localStorage.setItem(UI_KEY, JSON.stringify({
    metric: els.metric.value, brand: els.brand.value, category: els.category.value,
    channel: els.channel.value, maxPrice: els.maxPrice.value, search: els.search.value,
    budget: els.budget.value, budgetMetric: els.budgetMetric.value, budgetBrand: els.budgetBrand.value,
    comboBudget: els.comboBudget.value, comboBrand: els.comboBrand.value, comboSize: els.comboSize.value, comboMetric: els.comboMetric.value,
    foodOnly: els.foodOnly.checked
  }));
}

/* ---------- theme ---------- */
function effectiveTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) return stored;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(THEME_KEY, theme);
  els.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* ---------- init ---------- */
async function init() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) applyTheme(stored, false); else els.themeToggle.textContent = effectiveTheme() === 'dark' ? '☀️' : '🌙';

  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL}: ${res.status}`);
  seed = await res.json();
  try {
    const ingRes = await fetch(INGREDIENTS_URL, { cache: 'no-cache' });
    if (ingRes.ok) ingredients = await ingRes.json();
  } catch { ingredients = {}; }
  const local = loadLocal();
  items = (local?.items?.length ? local.items : seed.items).map(normaliseItem);

  renderDataChip();
  restoreUI(loadUI());
  bindEvents();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function renderDataChip() {
  const meta = seed.metadata || {};
  const lf = meta.liveFetch || {};
  const loc = shortLocation(lf.location);
  const when = meta.updated ? fmtDate(meta.updated) : '';
  els.dataChip.textContent = loc ? `📍 ${loc}${when ? ` · ${when}` : ''}` : (when || 'Local data');
  els.dataChip.title = lf.location ? `Pickup prices near ${lf.location}, updated ${when}` : 'Data from data/foods.json';
}
function shortLocation(raw) {
  if (!raw) return '';
  const m = String(raw).match(/\(([^,)]+)/);       // first name inside the parens
  const pc = String(raw).match(/\b(\d{4})\b/);
  const name = m ? m[1].trim() : String(raw).replace(/postcode\s*/i, '').trim();
  return pc ? `${name} ${pc[1]}` : name;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function restoreUI(ui) {
  if (ui.metric) els.metric.value = ui.metric;
  if (ui.foodOnly === false) els.foodOnly.checked = false;
  if (ui.channel) els.channel.value = ui.channel;
  if (ui.maxPrice) els.maxPrice.value = ui.maxPrice;
  if (ui.search) els.search.value = ui.search;
  if (ui.budget) els.budget.value = ui.budget;
  if (ui.budgetMetric) els.budgetMetric.value = ui.budgetMetric;
  if (ui.comboBudget) els.comboBudget.value = ui.comboBudget;
  if (ui.comboSize) els.comboSize.value = ui.comboSize;
  if (ui.comboMetric) els.comboMetric.value = ui.comboMetric;
  els._pendingBrand = ui.brand; els._pendingCat = ui.category; els._pendingBudgetBrand = ui.budgetBrand; els._pendingComboBrand = ui.comboBrand;
}

function bindEvents() {
  els.tabs.addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) switchTab(t.dataset.tab); });
  ['input', 'change'].forEach(evt => {
    [els.search, els.metric, els.brand, els.category, els.channel, els.maxPrice, els.foodOnly].forEach(el => el.addEventListener(evt, () => { saveUI(); renderCompare(); }));
    [els.budget, els.budgetMetric, els.budgetBrand].forEach(el => el.addEventListener(evt, () => { saveUI(); renderBudget(); }));
    [els.comboBudget, els.comboBrand, els.comboSize, els.comboMetric].forEach(el => el.addEventListener(evt, () => { saveUI(); renderCombos(); }));
  });
  els.clearFilters.addEventListener('click', () => {
    els.search.value = ''; els.brand.value = 'all'; els.category.value = 'all';
    els.channel.value = 'pickup'; els.maxPrice.value = ''; els.metric.value = 'kjPerDollar'; els.foodOnly.checked = true;
    saveUI(); renderCompare();
  });
  els.ranking.addEventListener('click', onEditClick);
  els.form.addEventListener('submit', saveItemFromForm);
  els.newItem.addEventListener('click', clearForm);
  els.deleteItem.addEventListener('click', deleteCurrentItem);
  els.exportJson.addEventListener('click', exportJson);
  els.importJson.addEventListener('click', importJson);
  els.resetEdits.addEventListener('click', resetLocalEdits);
  els.themeToggle.addEventListener('click', () => applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark', true));
}
function onEditClick(e) {
  const edit = e.target.closest('button[data-edit]');
  if (edit) { editItem(edit.dataset.edit); return; }
  const mk = e.target.closest('.makeup-toggle');
  if (mk) {
    const panel = mk.closest('.main').querySelector('.row-detail');
    if (panel) {
      const open = !panel.hidden;
      panel.hidden = open;
      mk.setAttribute('aria-expanded', String(!open));
      mk.textContent = open ? "what's in it ⌄" : "what's in it ⌃";
    }
  }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach(p => {
    const on = p.id === `tab-${name}`;
    p.classList.toggle('is-active', on); p.hidden = !on;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- filters ---------- */
function populateFilters() {
  const brands = ['all', ...[...new Set(items.map(i => i.brand))].sort()];
  const cats = ['all', ...[...new Set(items.map(i => i.category))].sort()];
  fillSelect(els.brand, brands, els._pendingBrand ?? els.brand.value, 'All chains');
  fillSelect(els.budgetBrand, brands, els._pendingBudgetBrand ?? els.budgetBrand.value, 'All chains');
  fillSelect(els.comboBrand, brands, els._pendingComboBrand ?? els.comboBrand.value, 'Any chain');
  fillSelect(els.category, cats, els._pendingCat ?? els.category.value, 'All categories');
  fillDatalist(els.brandList, brands.slice(1));
  fillDatalist(els.categoryList, cats.slice(1));
  els._pendingBrand = els._pendingCat = els._pendingBudgetBrand = els._pendingComboBrand = undefined;
}
function fillSelect(sel, vals, previous, allLabel) {
  sel.innerHTML = vals.map(v => `<option value="${escapeHtml(v)}">${v === 'all' ? allLabel : escapeHtml(v)}</option>`).join('');
  if (vals.includes(previous)) sel.value = previous;
}
const fillDatalist = (dl, vals) => { dl.innerHTML = vals.map(v => `<option value="${escapeHtml(v)}"></option>`).join(''); };

function matchesChannel(item) {
  const wanted = els.channel.value || 'pickup';
  if (wanted === 'all') return true;
  const channel = (item.channel || '').toLowerCase();
  return wanted === 'delivery' ? channel === 'delivery' : channel !== 'delivery';
}
// A mayo packet is technically the most kJ per dollar; "Food only" keeps the
// ranking about meals by dropping drink and sauce categories.
const NON_FOOD = /sauce|dip|drink|water|mayo|aioli|condiment/i;
const isFood = item => !NON_FOOD.test(item.category) && !NON_FOOD.test(item.item);
function baseFiltered() {
  const query = els.search.value.trim().toLowerCase();
  const max = Number(els.maxPrice.value);
  return items.map(withMetrics).filter(i => {
    const q = `${i.item} ${i.brand} ${i.category} ${i.note}`.toLowerCase();
    return (!query || q.includes(query)) &&
      (els.brand.value === 'all' || i.brand === els.brand.value) &&
      (els.category.value === 'all' || i.category === els.category.value) &&
      (!els.foodOnly.checked || isFood(i)) &&
      matchesChannel(i) && i.price > 0 &&
      (!Number.isFinite(max) || max <= 0 || i.price <= max);
  });
}

/* ---------- render: compare ---------- */
function renderAll() { populateFilters(); renderCompare(); renderBudget(); renderCombos(); }

function renderCompare() {
  const metric = els.metric.value;
  const info = METRICS[metric];
  let rows = baseFiltered();
  // Only show rows that actually have the ranked nutrient, so we never render a wall of dashes.
  if (metric !== 'price') rows = rows.filter(i => i[metric] > 0);
  rows.sort(metric === 'price' ? (a, b) => a.price - b.price : (a, b) => b[metric] - a[metric]);

  renderPodium(rows.slice(0, 3), metric, info);
  renderStats(rows, metric, info);
  renderRanking(rows, metric, info);
  els.introMeta.textContent = introText();
  els.metricNote.textContent = metricNote(metric, rows.length);
}
function introText() {
  const lf = (seed.metadata || {}).liveFetch || {};
  const chains = new Set(items.map(i => i.brand)).size;
  const loc = shortLocation(lf.location);
  const bits = [`${n0.format(items.length)} items`, `${chains} chains`];
  if (loc) bits.push(`pickup prices near ${loc}`);
  return bits.join(' · ');
}
function metricNote(metric, shown) {
  if (metric === 'price') return `${n0.format(shown)} items shown, cheapest first.`;
  const info = METRICS[metric];
  const covered = items.filter(i => hasNum(i[info.nutrient]) && Number(i[info.nutrient]) > 0).length;
  const noun = { energyKj: 'kilojoules', energyCal: 'calories', proteinGrams: 'protein', serveGrams: 'serve weight' }[info.nutrient];
  return `Showing the ${n0.format(shown)} items that publish ${noun}. ${n0.format(covered)} of ${n0.format(items.length)} items carry it.`;
}
function metricValue(item, metric) {
  if (metric === 'price') return fmtMoney(item.price);
  return item[metric] > 0 ? METRICS[metric].fmt.format(item[metric]) : '—';
}
function brandTag(brand) {
  const c = BRAND_COLORS[brand] || '#6b7280';
  return `<span class="brandtag" style="background:${c}">${escapeHtml(brand)}</span>`;
}
function makeupPanel(info) {
  const parts = [];
  if (info.ingredients && info.ingredients.length) {
    const label = info.ingredientsNote && info.ingredientsNote.includes('combo') ? 'Includes' : 'Made with';
    parts.push(`<div class="mk-row"><span class="mk-label">${label}</span> ${info.ingredients.map(escapeHtml).join(', ')}</div>`);
  }
  if (info.allergens && info.allergens.length) {
    parts.push(`<div class="mk-row"><span class="mk-label">Allergens</span> ${info.allergens.map(escapeHtml).join(', ')}</div>`);
  }
  const src = info.source ? `<div class="mk-src">${escapeHtml(info.source)}</div>` : '';
  return `<div class="row-detail" hidden>${parts.join('')}${src}</div>`;
}
function renderPodium(top, metric, info) {
  els.podium.innerHTML = top.map((i, idx) => `
    <div class="podium-card">
      <span class="bar"></span>
      <div class="rank">#${idx + 1} best value</div>
      <div class="p-item">${escapeHtml(i.item)}</div>
      <div class="p-val">${metricValue(i, metric)} <small>${metric === 'price' ? '' : info.unit}</small></div>
      <div class="p-sub">${brandTag(i.brand)} · ${fmtMoney(i.price)}${metric !== 'price' && i.energyKj ? ` · ${n0.format(i.energyKj)} kJ` : ''}</div>
    </div>`).join('');
}
function renderStats(rows, metric, info) {
  const best = rows[0];
  const avg = rows.reduce((s, i) => s + i.price, 0) / (rows.length || 1);
  const cells = [
    ['Items', n0.format(rows.length)],
    ['Avg price', money.format(avg || 0)],
    ['Top chain', best ? best.brand : '—'],
    [metric === 'price' ? 'Cheapest' : `Best ${info.unit}`, best ? metricValue(best, metric) : '—']
  ];
  els.quickStats.innerHTML = cells.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');
}
function renderRanking(rows, metric, info) {
  els.rankingEmpty.hidden = rows.length > 0;
  const maxV = metric === 'price'
    ? Math.min(...rows.map(r => r.price).filter(Boolean), Infinity)
    : Math.max(...rows.map(r => r[metric]), 0);
  els.ranking.innerHTML = rows.slice(0, 200).map((i, idx) => {
    const pct = metric === 'price'
      ? (i.price ? Math.max(6, Math.round((maxV / i.price) * 100)) : 0)
      : (maxV ? Math.max(4, Math.round((i[metric] / maxV) * 100)) : 0);
    const sub = metric === 'price'
      ? (i.energyKj ? `${n0.format(i.energyKj)} kJ` : escapeHtml(i.category))
      : `${info.unit}`;
    const makeup = itemInfo(i.brand, i.item);
    const hasMakeup = makeup && ((makeup.ingredients && makeup.ingredients.length) || (makeup.allergens && makeup.allergens.length));
    return `<li class="row ${idx < 3 ? 'top' : ''} ${i.userEdited ? 'edited' : ''}">
      <span class="bar" style="width:${pct}%"></span>
      <span class="rk">${idx + 1}</span>
      <div class="main">
        <div class="name">${escapeHtml(i.item)}</div>
        <div class="meta">${brandTag(i.brand)}<span class="dot"></span>${escapeHtml(i.category)}${i.note ? `<span class="dot"></span>${escapeHtml(i.note.length > 44 ? i.note.slice(0, 44).replace(/\s+\S*$/, '') + '…' : i.note)}` : ''}<span class="dot"></span><button class="editlink" data-edit="${escapeHtml(i.id)}" type="button">edit</button>${hasMakeup ? `<span class="dot"></span><button class="makeup-toggle" type="button" aria-expanded="false">what's in it ⌄</button>` : ''}</div>
        ${hasMakeup ? makeupPanel(makeup) : ''}
      </div>
      <div class="val">
        <div class="m">${metricValue(i, metric)} <span class="u">${metric === 'price' ? '' : sub}</span></div>
        <div class="price">${metric === 'price' ? escapeHtml(i.category) : fmtMoney(i.price)}</div>
      </div>
    </li>`;
  }).join('');
}

/* ---------- render: budget ---------- */
function renderBudget() {
  const budget = Number(els.budget.value);
  const metric = els.budgetMetric.value;
  const info = METRICS[metric];
  if (!Number.isFinite(budget) || budget <= 0) { els.budgetSummary.textContent = 'Enter a budget to see what fits.'; els.budgetList.innerHTML = ''; return; }
  let rows = items.map(withMetrics).filter(i => i.price > 0 && matchesChannel(i) && i.price <= budget && i[metric] > 0 && isFood(i) &&
    (els.budgetBrand.value === 'all' || i.brand === els.budgetBrand.value));
  rows.sort((a, b) => b[metric] - a[metric]);
  const best = rows[0];
  els.budgetSummary.innerHTML = best
    ? `Best under ${money.format(budget)}: <strong>${escapeHtml(best.item)}</strong> — ${brandTag(best.brand)} at ${fmtMoney(best.price)} (${info.fmt.format(best[metric])} ${info.unit}).`
    : `Nothing with that data fits under ${money.format(budget)}.`;
  els.budgetList.innerHTML = rows.slice(0, 12).map((i, idx) => `
    <li class="row ${idx < 3 ? 'top' : ''}">
      <span class="bar" style="width:${Math.max(4, Math.round((i[metric] / rows[0][metric]) * 100))}%"></span>
      <span class="rk">${idx + 1}</span>
      <div class="main"><div class="name">${escapeHtml(i.item)}</div>
        <div class="meta">${brandTag(i.brand)}<span class="dot"></span>${escapeHtml(i.category)}</div></div>
      <div class="val"><div class="m">${info.fmt.format(i[metric])} <span class="u">${info.unit}</span></div><div class="price">${fmtMoney(i.price)}</div></div>
    </li>`).join('');
}

/* ---------- render: combos (logic preserved) ---------- */
const comboLabel = m => ({ serveGrams: 'grams', energyKj: 'kJ', energyCal: 'Cal', proteinGrams: 'g protein' }[m] || m);
const comboVal = (item, m) => (hasNum(item[m]) ? Number(item[m]) : 0);
function renderCombos() {
  const budget = Number(els.comboBudget.value);
  const metric = els.comboMetric.value;
  const brand = els.comboBrand.value;
  const maxItems = Math.max(2, Math.min(4, Number(els.comboSize.value) || 3));
  if (!Number.isFinite(budget) || budget <= 0) { els.comboSummary.textContent = 'Enter a budget to build combos.'; els.comboList.innerHTML = ''; return; }
  const ignored = new Set(['Drink', 'Drinks', 'Sauce', 'Sauces']);
  const bundleCats = new Set(['Meal Deal', 'Boxed Meal', 'Shared Meal', 'Deals']);
  const raw = items.map(withMetrics).filter(i => i.price > 0 && matchesChannel(i) && i.price <= budget && !ignored.has(i.category) && (brand === 'all' || i.brand === brand) && comboVal(i, metric) > 0);
  const byValue = [...raw].sort((a, b) => comboVal(b, metric) / b.price - comboVal(a, metric) / a.price).slice(0, 36);
  const byCheap = [...raw].sort((a, b) => a.price - b.price).slice(0, 18);
  const candidates = [...new Map([...byValue, ...byCheap].map(i => [i.id, i])).values()].sort((a, b) => a.price - b.price);
  const combos = [];
  const addCombo = picks => {
    const totals = picks.reduce((a, i) => { a.price += i.price; a.serveGrams += comboVal(i, 'serveGrams'); a.energyKj += comboVal(i, 'energyKj'); a.energyCal += comboVal(i, 'energyCal'); a.proteinGrams += comboVal(i, 'proteinGrams'); return a; }, { price: 0, serveGrams: 0, energyKj: 0, energyCal: 0, proteinGrams: 0 });
    if (picks.length >= 2 && totals.price <= budget && (totals[metric] || 0) > 0) combos.push({ items: [...picks], totals });
  };
  (function walk(start, picks, price) {
    if (picks.length >= 2) addCombo(picks);
    if (picks.length >= maxItems) return;
    for (let idx = start; idx < candidates.length; idx += 1) {
      const it = candidates[idx];
      if (price + it.price > budget) continue;
      if (bundleCats.has(it.category) && picks.some(p => bundleCats.has(p.category))) continue;
      picks.push(it); walk(idx + 1, picks, price + it.price); picks.pop();
    }
  })(0, [], 0);
  const unique = [...new Map(combos.map(c => [c.items.map(i => i.id).sort().join('|'), c])).values()]
    .sort((a, b) => (b.totals[metric] - a.totals[metric]) || (b.totals[metric] / b.totals.price - a.totals[metric] / a.totals.price) || a.totals.price - b.totals.price)
    .slice(0, 8);
  const best = unique[0];
  els.comboSummary.innerHTML = best
    ? `Best ${maxItems}-item combo under ${money.format(budget)}: <strong>${n0.format(best.totals[metric])} ${comboLabel(metric)}</strong> for ${money.format(best.totals.price)}.`
    : `No 2–${maxItems} item combos fit under ${money.format(budget)} for that chain.`;
  els.comboList.innerHTML = unique.map((c, i) => `
    <article class="combo-card">
      <div class="combo-rank">#${i + 1}</div>
      <div>
        <h3>${n0.format(c.totals[metric])} ${comboLabel(metric)} · ${money.format(c.totals.price)}</h3>
        <p class="muted">${fmtNum(c.totals.energyKj, n0, ' kJ')} · ${fmtNum(c.totals.proteinGrams, n1, ' g protein')}</p>
        <ul>${c.items.map(it => `<li>${escapeHtml(it.item)} <span>${escapeHtml(it.brand)} · ${fmtMoney(it.price)}</span></li>`).join('')}</ul>
      </div>
    </article>`).join('');
}

/* ---------- manage ---------- */
function editItem(id) {
  const it = items.find(i => i.id === id); if (!it) return;
  switchTab('manage');
  editingId = id; els.formTitle.textContent = `Edit ${it.item}`; els.itemId.value = id;
  els.itemName.value = it.item; els.itemBrand.value = it.brand; els.itemCategory.value = it.category;
  els.itemPrice.value = it.price || ''; els.itemServe.value = it.serveGrams || ''; els.itemKj.value = it.energyKj || '';
  els.itemCal.value = it.energyCal || ''; els.itemProtein.value = it.proteinGrams || ''; els.itemNote.value = it.note || '';
  els.deleteItem.disabled = false;
}
function clearForm() { editingId = null; els.form.reset(); els.formTitle.textContent = 'Add an item'; els.deleteItem.disabled = true; }
function saveItemFromForm(e) {
  e.preventDefault();
  const id = els.itemId.value || `${slug(els.itemBrand.value)}-${slug(els.itemName.value)}-${Date.now().toString(36)}`;
  const prev = items.find(i => i.id === id);
  const it = normaliseItem({ id, channel: prev?.channel, storeLabel: prev?.storeLabel, item: els.itemName.value, brand: els.itemBrand.value, category: els.itemCategory.value, price: els.itemPrice.value, serveGrams: els.itemServe.value, energyKj: els.itemKj.value, energyCal: els.itemCal.value, proteinGrams: els.itemProtein.value, note: els.itemNote.value, sourceFile: 'local edit', userEdited: true });
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) items[idx] = it; else items.unshift(it);
  saveLocal(); editingId = it.id; els.itemId.value = it.id; els.deleteItem.disabled = false;
  els.dataStatus.textContent = `Saved ${it.item}. Export JSON to update the public site.`;
  populateFilters(); renderAll();
}
function deleteCurrentItem() {
  if (!editingId) return;
  const it = items.find(i => i.id === editingId);
  if (!confirm(`Delete ${it?.item || 'this item'} from your local data?`)) return;
  items = items.filter(i => i.id !== editingId); saveLocal(); clearForm(); populateFilters(); renderAll();
  els.dataStatus.textContent = 'Item deleted locally.';
}
function exportJson() {
  const payload = { metadata: { ...seed.metadata, exportedAt: new Date().toISOString(), updateInstructions: 'Replace data/foods.json with this file and commit.' }, items: items.map(normaliseItem) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'foods.json' });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  els.dataStatus.textContent = 'Exported foods.json.';
}
function importJson() {
  try {
    const parsed = JSON.parse(els.importText.value);
    if (!Array.isArray(parsed.items)) throw new Error('JSON must contain an items array.');
    items = parsed.items.map(i => normaliseItem({ ...i, userEdited: true }));
    saveLocal(); populateFilters(); renderAll();
    els.dataStatus.textContent = `Imported ${items.length} items locally.`;
  } catch (err) { els.dataStatus.textContent = `Import failed: ${err.message}`; }
}
function resetLocalEdits() {
  if (!confirm('Reset all local edits back to the published data?')) return;
  localStorage.removeItem(STORAGE_KEY); items = seed.items.map(normaliseItem); clearForm(); populateFilters(); renderAll();
  els.dataStatus.textContent = 'Local edits reset.';
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div style="margin:1rem;padding:1rem;border:1px solid var(--border);border-radius:12px">Failed to load site data: ${escapeHtml(err.message)}</div>`);
});
window.__fastFoodValue = { get items() { return items.map(withMetrics); } };
