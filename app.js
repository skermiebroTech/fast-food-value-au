import {
  METRICS, TYPE_GROUPS, DAILY_KJ, KJ_PER_CAL, channelOf, deriveRows, dedupe, rank, coverage, chainsWith, perDollar,
  matchesSearch, searchTokens, matchesType, normaliseItem, applyOverlay, exportItem, round
} from './lib/value.js';
import { bestCombos } from './lib/combos.js';

const DATA_URL = 'data/foods.json';
const INGREDIENTS_URL = 'data/ingredients.json';
const EDITS_KEY = 'au-fast-food-value.edits.v9';
const LEGACY_ITEMS_KEY = 'au-fast-food-value.items.v8';
const UI_KEY = 'au-fast-food-value.ui.v2';
const LEGACY_UI_KEY = 'au-fast-food-value.ui.v1';
const THEME_KEY = 'au-fast-food-value.theme.v1';
const PAGE = 40;
const TABS = ['compare', 'budget', 'combos', 'manage'];

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const els = {
  dataChip: $('#dataChip'), themeToggle: $('#themeToggle'), themeColor: $('#themeColor'), tabs: $('#tabs'),
  prefs: $('#prefs'), prefsNote: $('#prefsNote'),
  lede: $('#metricLede'), podium: $('#podium'), search: $('#search'), brand: $('#brand'), type: $('#type'),
  filtersToggle: $('#filtersToggle'), filtersPanel: $('#filtersPanel'), filterCount: $('#filterCount'),
  category: $('#category'), maxPrice: $('#maxPrice'), minSize: $('#minSize'), foodOnly: $('#foodOnly'),
  resetFilters: $('#resetFilters'), coverage: $('#coverage'), compareStatus: $('#compareStatus'),
  ranking: $('#ranking'), rankingEmpty: $('#rankingEmpty'), moreRows: $('#moreRows'),
  unranked: $('#unranked'), unrankedSummary: $('#unrankedSummary'), unrankedHint: $('#unrankedHint'),
  unrankedList: $('#unrankedList'), moreUnranked: $('#moreUnranked'), coverageTable: $('#coverageTable'),
  budget: $('#budget'), budgetBrand: $('#budgetBrand'), budgetResult: $('#budgetResult'),
  budgetList: $('#budgetList'), budgetNote: $('#budgetNote'),
  comboBudget: $('#comboBudget'), comboBrand: $('#comboBrand'), comboResult: $('#comboResult'),
  comboList: $('#comboList'), comboNote: $('#comboNote'),
  localState: $('#localState'), findItem: $('#findItem'), findResults: $('#findResults'),
  form: $('#itemForm'), formTitle: $('#formTitle'), itemId: $('#itemId'), itemName: $('#itemName'),
  itemBrand: $('#itemBrand'), itemCategory: $('#itemCategory'), itemChannel: $('#itemChannel'),
  itemPrice: $('#itemPrice'), itemServe: $('#itemServe'), itemKj: $('#itemKj'), itemCal: $('#itemCal'),
  itemProtein: $('#itemProtein'), itemNote: $('#itemNote'), deleteItem: $('#deleteItem'), newItem: $('#newItem'),
  exportJson: $('#exportJson'), importFile: $('#importFile'), importText: $('#importText'),
  importJson: $('#importJson'), resetEdits: $('#resetEdits'), dataStatus: $('#dataStatus'),
  brandList: $('#brandList'), categoryList: $('#categoryList')
};

/* ---------- formatting ---------- */
const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const n0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('en-AU', { style: 'percent', maximumFractionDigits: 0 });
const listOf = new Intl.ListFormat('en-AU', { style: 'long', type: 'conjunction' });
const fmtMoney = v => (v ? money.format(v) : '—');
const escapeHtml = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n0.format(n)} ${n === 1 ? one : many}`;

// Field-level wording. kJ and Cal are the same figure in two units; the toggle picks one.
const FIELD = {
  kj: { short: 'kJ', unit: 'kJ', per: 'kJ/$', noun: 'kilojoules', most: 'energy', num: n0, rate: n0 },
  cal: { short: 'Cal', unit: 'Cal', per: 'Cal/$', noun: 'Calories', most: 'energy', num: n0, rate: n0 },
  protein: { short: 'protein', unit: 'g protein', per: 'g protein/$', noun: 'protein', most: 'protein', num: n1, rate: n1 },
  grams: { short: 'weight', unit: 'g', per: 'g/$', noun: 'a serve weight', most: 'food by weight', num: n0, rate: n0 }
};
for (const f of Object.values(FIELD)) f.amount = v => `${f.num.format(v)} ${f.unit}`;
const DAY = { kj: DAILY_KJ, cal: DAILY_KJ / KJ_PER_CAL };

/* ---------- storage (unavailable in some private modes; the page works without it) ---------- */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  json(key, fallback) { try { return JSON.parse(this.get(key)) ?? fallback; } catch { return fallback; } }
};

/* ---------- state ---------- */
const DEFAULT_UI = {
  channel: 'pickup', unit: 'kj',
  metric: 'energy', brand: 'all', type: 'all', category: 'all', maxPrice: '', minSize: '0', foodOnly: true, search: '',
  budget: '15', budgetMetric: 'energy', budgetSort: 'total', budgetBrand: 'all',
  comboBudget: '20', comboMetric: 'energy', comboSize: '3', comboBrand: 'each'
};
const CHOICES = {
  channel: ['pickup', 'delivery'], unit: ['kj', 'cal'], metric: Object.keys(METRICS),
  budgetMetric: ['energy', 'protein', 'grams'], budgetSort: ['total', 'value'],
  comboMetric: ['energy', 'protein', 'grams'], comboSize: ['2', '3', '4'], minSize: ['0', '1000', '2500', '4000'],
  type: ['all', 'bundle', ...Object.keys(TYPE_GROUPS)]
};
let ui = { ...DEFAULT_UI };
let tab = 'compare';
let seed = { metadata: {}, items: [] };
let ingredients = {};
let overlay = { edits: {}, deleted: [], imported: null };
let items = [];   // stored-shape items in effect (published data + local overlay)
let rows = [];    // derived rows, one per item
let editingId = null;
const view = { shown: PAGE, unrankedShown: PAGE, compare: null };
const dirty = new Set(TABS);

/* ---------- UI persistence ---------- */
function loadUI() {
  let saved = store.json(UI_KEY, null);
  if (!saved) {
    const old = store.json(LEGACY_UI_KEY, null);
    if (old) saved = migrateUI(old);
  }
  const next = { ...DEFAULT_UI };
  for (const [k, v] of Object.entries(saved || {})) {
    if (v === undefined || v === null || !(k in DEFAULT_UI)) continue;
    if (CHOICES[k] && !CHOICES[k].includes(String(v))) continue;
    next[k] = typeof DEFAULT_UI[k] === 'boolean' ? Boolean(v) : String(v);
  }
  return next;
}
// v1 stored per-dollar metric names; "Nutrition" folded into Protein and "Both" order types into pickup.
function migrateUI(old) {
  const metric = { kjPerDollar: 'energy', calPerDollar: 'energy', nutriPerDollar: 'protein', proteinPerDollar: 'protein', gramsPerDollar: 'grams', price: 'price' };
  const nutrient = { energyKj: 'energy', energyCal: 'energy', proteinGrams: 'protein', serveGrams: 'grams' };
  return {
    metric: metric[old.metric], unit: old.metric === 'calPerDollar' ? 'cal' : undefined,
    channel: old.channel === 'delivery' ? 'delivery' : 'pickup',
    brand: old.brand, category: old.category, maxPrice: old.maxPrice, search: old.search, foodOnly: old.foodOnly,
    budget: old.budget, budgetMetric: metric[old.budgetMetric], budgetBrand: old.budgetBrand,
    comboBudget: old.comboBudget, comboMetric: nutrient[old.comboMetric], comboSize: old.comboSize
  };
}
const saveUI = () => store.set(UI_KEY, JSON.stringify(ui));

/* ---------- theme ---------- */
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const activeTheme = () => document.documentElement.dataset.theme || (darkQuery?.matches ? 'dark' : 'light');
function syncTheme() {
  const theme = activeTheme();
  els.themeToggle.dataset.theme = theme;
  els.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  els.themeColor.content = theme === 'dark' ? '#171b22' : '#ffffff';
}
function toggleTheme() {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set(THEME_KEY, next);
  syncTheme();
}

/* ---------- init ---------- */
async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return res.json();
}

async function init() {
  syncTheme();
  const [data, ing] = await Promise.all([fetchJson(DATA_URL), fetchJson(INGREDIENTS_URL).catch(() => ({}))]);
  seed = data && Array.isArray(data.items) ? data : { metadata: {}, items: [] };
  ingredients = ing || {};
  overlay = loadOverlay();
  ui = loadUI();
  restoreControls();
  bindEvents();
  refreshData();
  renderDataChip();
  showTab(tabFromHash() || 'compare', { updateHash: false });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function refreshData() {
  items = applyOverlay(seed.items, overlay);
  rows = deriveRows(items);
  const keep = new Set(dedupe(rows));
  rows.forEach((r, i) => { r.idx = i; r.dup = !keep.has(r); });
  populateSelects();
  invalidate(...TABS);
}

function renderDataChip() {
  const meta = seed.metadata || {};
  const lf = meta.liveFetch || {};
  const loc = shortLocation(lf.location);
  const when = meta.updated ? fmtDate(meta.updated) : '';
  els.dataChip.textContent = loc ? `${loc}${when ? ` · ${when}` : ''}` : (when || 'Local data');
  els.dataChip.title = lf.location ? `Prices from the store nearest ${lf.location}, updated ${when}` : 'Data from data/foods.json';
}
function shortLocation(raw) {
  if (!raw) return '';
  const m = String(raw).match(/\(([^,)]+)/);
  const pc = String(raw).match(/\b(\d{4})\b/);
  const name = m ? m[1].trim() : String(raw).replace(/postcode\s*/i, '').trim();
  return pc && !name.includes(pc[1]) ? `${name} ${pc[1]}` : name;
}
// Date-only strings are read as local dates so the day doesn't shift across time zones.
function fmtDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/* ---------- controls ---------- */
const setRadio = (name, value) => { const el = $(`input[name="${name}"][value="${value}"]`); if (el) el.checked = true; };
function restoreControls() {
  for (const name of ['channel', 'unit', 'metric', 'budgetMetric', 'budgetSort', 'comboMetric', 'comboSize']) setRadio(name, ui[name]);
  els.search.value = ui.search;
  els.maxPrice.value = ui.maxPrice;
  els.foodOnly.checked = ui.foodOnly;
  els.budget.value = ui.budget;
  els.comboBudget.value = ui.comboBudget;
  els.type.value = ui.type;
  renderMinSizeOptions();
}

function populateSelects() {
  const brands = [...new Set(rows.map(r => r.brand))].sort((a, b) => a.localeCompare(b));
  const opts = (list, selected) => list.map(([v, label]) => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const brandOpts = brands.map(b => [b, b]);
  for (const [el, key, first] of [[els.brand, 'brand', [['all', 'All chains']]], [els.budgetBrand, 'budgetBrand', [['all', 'All chains']]],
    [els.comboBrand, 'comboBrand', [['each', 'Best at each chain'], ['mix', 'Mix any chains']]]]) {
    const list = [...first, ...brandOpts];
    if (!list.some(([v]) => v === ui[key])) ui[key] = list[0][0];
    el.innerHTML = opts(list, ui[key]);
  }
  populateCategories();
  els.brandList.innerHTML = brands.map(b => `<option value="${escapeHtml(b)}"></option>`).join('');
  els.categoryList.innerHTML = [...new Set(rows.map(r => r.category))].sort().map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
}
// Menu categories are each chain's own, so the list follows the chosen chain.
function populateCategories() {
  if (ui.brand === 'all') {
    ui.category = 'all';
    els.category.innerHTML = '<option value="all">Pick a chain first</option>';
    els.category.disabled = true;
    return;
  }
  const cats = [...new Set(rows.filter(r => r.brand === ui.brand && r.channel === ui.channel).map(r => r.category))].sort();
  if (!cats.includes(ui.category)) ui.category = 'all';
  els.category.innerHTML = [['all', 'All categories'], ...cats.map(c => [c, c])]
    .map(([v, l]) => `<option value="${escapeHtml(v)}"${v === ui.category ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  els.category.disabled = false;
}
function renderMinSizeOptions() {
  const labels = { 0: 'Any size', 1000: 'Snack or bigger', 2500: 'Meal-sized', 4000: 'Big meal' };
  els.minSize.innerHTML = CHOICES.minSize.map(v => {
    const kj = Number(v);
    const amount = kj ? ` · ${ui.unit === 'cal' ? `${n0.format(Math.round(kj / KJ_PER_CAL / 10) * 10)} Cal` : `${n0.format(kj)} kJ`}+` : '';
    return `<option value="${v}"${v === ui.minSize ? ' selected' : ''}>${labels[v]}${amount}</option>`;
  }).join('');
}

function bindEvents() {
  els.tabs.addEventListener('click', e => { const t = e.target.closest('[role="tab"]'); if (t) showTab(t.id.replace('tab-', '')); });
  els.tabs.addEventListener('keydown', onTabKey);
  window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t) showTab(t, { updateHash: false }); });
  els.themeToggle.addEventListener('click', toggleTheme);
  darkQuery?.addEventListener?.('change', syncTheme);

  const radios = (name, key, after) => $$(`input[name="${name}"]`).forEach(input => input.addEventListener('change', () => {
    if (!input.checked) return;
    ui[key] = input.value; after(); saveUI();
  }));
  radios('channel', 'channel', () => { populateCategories(); resetPaging(); invalidate('compare', 'budget', 'combos'); });
  radios('unit', 'unit', () => { renderMinSizeOptions(); invalidate('compare', 'budget', 'combos'); });
  radios('metric', 'metric', () => { resetPaging(); invalidate('compare'); });
  radios('budgetMetric', 'budgetMetric', () => invalidate('budget'));
  radios('budgetSort', 'budgetSort', () => invalidate('budget'));
  radios('comboMetric', 'comboMetric', () => invalidate('combos'));
  radios('comboSize', 'comboSize', () => invalidate('combos'));

  const field = (el, key, tabName, { wait = 0, read = () => el.value, after } = {}) => {
    let timer = 0;
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
      ui[key] = read(); after?.(); saveUI();
      clearTimeout(timer);
      if (tabName === 'compare') resetPaging();
      timer = setTimeout(() => invalidate(tabName), wait);
    });
  };
  field(els.search, 'search', 'compare', { wait: 120 });
  field(els.brand, 'brand', 'compare', { after: populateCategories });
  field(els.type, 'type', 'compare');
  field(els.category, 'category', 'compare');
  field(els.maxPrice, 'maxPrice', 'compare', { wait: 150 });
  field(els.minSize, 'minSize', 'compare');
  field(els.foodOnly, 'foodOnly', 'compare', { read: () => els.foodOnly.checked });
  field(els.budget, 'budget', 'budget', { wait: 120 });
  field(els.budgetBrand, 'budgetBrand', 'budget');
  field(els.comboBudget, 'comboBudget', 'combos', { wait: 200 });
  field(els.comboBrand, 'comboBrand', 'combos');

  els.filtersToggle.addEventListener('click', () => {
    const open = els.filtersPanel.hidden;
    els.filtersPanel.hidden = !open;
    els.filtersToggle.setAttribute('aria-expanded', String(open));
  });
  els.resetFilters.addEventListener('click', resetFilters);
  els.moreRows.addEventListener('click', () => { view.shown += PAGE; renderRankingList(); });
  els.moreUnranked.addEventListener('click', () => { view.unrankedShown += PAGE; renderUnrankedList(); });
  $$('.chips').forEach(group => group.addEventListener('click', e => {
    const b = e.target.closest('button[data-amount]');
    if (!b) return;
    const input = document.getElementById(group.dataset.target);
    input.value = b.dataset.amount;
    input.dispatchEvent(new Event('input'));
  }));
  document.addEventListener('click', onDocClick);

  els.findItem.addEventListener('input', renderFinder);
  els.form.addEventListener('submit', saveItemFromForm);
  els.newItem.addEventListener('click', clearForm);
  els.deleteItem.addEventListener('click', deleteCurrentItem);
  els.itemKj.addEventListener('input', () => { els.itemCal.value = els.itemKj.value === '' ? '' : round(Number(els.itemKj.value) / KJ_PER_CAL, 2); });
  els.itemCal.addEventListener('input', () => { els.itemKj.value = els.itemCal.value === '' ? '' : round(Number(els.itemCal.value) * KJ_PER_CAL, 0); });
  els.exportJson.addEventListener('click', exportJson);
  els.importJson.addEventListener('click', () => importData(els.importText.value));
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files?.[0];
    if (file) importData(await file.text());
    els.importFile.value = '';
  });
  els.resetEdits.addEventListener('click', resetLocalEdits);
}

function onDocClick(e) {
  const edit = e.target.closest('[data-edit]');
  if (edit) { editItem(edit.dataset.edit); return; }
  const detail = e.target.closest('[data-detail]');
  if (detail) { toggleDetail(detail); return; }
  if (e.target.closest('[data-show-unranked]')) {
    els.unranked.open = true;
    els.unranked.scrollIntoView({ block: 'start' });
    els.unrankedSummary.focus();
  }
}

function resetFilters() {
  Object.assign(ui, { search: '', brand: 'all', type: 'all', category: 'all', maxPrice: '', minSize: '0', foodOnly: true });
  els.search.value = ''; els.brand.value = 'all'; els.type.value = 'all'; els.maxPrice.value = ''; els.foodOnly.checked = true;
  els.minSize.value = '0';
  populateCategories(); saveUI(); resetPaging(); invalidate('compare');
}
const resetPaging = () => { view.shown = PAGE; view.unrankedShown = PAGE; };

/* ---------- tabs ---------- */
const tabFromHash = () => { const t = location.hash.slice(1); return TABS.includes(t) ? t : null; };
function showTab(name, { updateHash = true, focus = false } = {}) {
  tab = name;
  for (const t of TABS) {
    const on = t === name;
    const btn = document.getElementById(`tab-${t}`);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    document.getElementById(`panel-${t}`).hidden = !on;
  }
  els.prefs.hidden = name === 'manage';
  if (updateHash) history.replaceState(null, '', name === 'compare' ? location.pathname + location.search : `#${name}`);
  if (focus) document.getElementById(`tab-${name}`).focus();
  renderActive();
  window.scrollTo(0, 0);
}
function onTabKey(e) {
  const i = TABS.indexOf(tab);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  showTab(TABS[(next + TABS.length) % TABS.length], { focus: true });
}

/* ---------- render scheduling: only the visible tab renders; others catch up when shown ---------- */
let frame = 0;
function invalidate(...names) {
  names.forEach(n => dirty.add(n));
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderActive(); });
}
const RENDER = { compare: renderCompare, budget: renderBudget, combos: renderCombos, manage: renderManage };
function renderActive() {
  renderPrefs();
  if (dirty.has(tab)) { dirty.delete(tab); RENDER[tab](); }
}

/* ---------- shared bits ---------- */
const energyField = () => (ui.unit === 'cal' ? 'cal' : 'kj');
const fieldFor = metric => (metric === 'energy' ? energyField() : METRICS[metric].field);
const inChannel = r => r.channel === ui.channel && r.price && !r.dup && r.kind !== 'other';

function renderPrefs() {
  const live = rows.filter(inChannel);
  const chains = new Set(live.map(r => r.brand)).size;
  const loc = shortLocation(seed.metadata?.liveFetch?.location);
  const when = seed.metadata?.updated ? fmtDate(seed.metadata.updated) : '';
  els.prefsNote.textContent = `${plural(live.length, `${ui.channel} item`)} from ${plural(chains, 'chain')}${loc ? ` · priced near ${loc}` : ''}${when ? ` · ${when}` : ''}`;
  // Each metric shows which chains it can actually compare.
  const scopeRows = live.filter(r => r.kind === 'food');
  const allChains = new Set(scopeRows.map(r => r.brand)).size;
  for (const metric of ['energy', 'protein', 'grams']) {
    const have = chainsWith(scopeRows, fieldFor(metric));
    const label = have.length === allChains ? 'all chains' : have.length === 0 ? 'no data' : have.length <= 2 ? have.join(' · ') : `${have.length} chains`;
    $$(`[data-scope="${metric}"]`).forEach(el => { el.textContent = label; });
  }
}

const BRAND_COLORS = {
  "McDonald's": '#c8102e', 'KFC': '#a3080f', 'Subway': '#0a7d34', 'GYG': '#c4160a', "Hungry Jack's": '#b8461b',
  "Domino's": '#0b6cae', 'Pizza Hut': '#9e1b32', 'Red Rooster': '#b4131f', 'Oporto': '#c25700',
  "Carl's Jr": '#a8120c', "Grill'd": '#4d7c3a'
};
const brandTag = brand => `<span class="brandtag" style="background:${BRAND_COLORS[brand] || '#5f6875'}">${escapeHtml(brand)}</span>`;

// Clean line-style SVG icons (stroke = currentColor, so they follow the theme).
const SVG = s => `<svg viewBox="0 0 24 24">${s}</svg>`;
const FOOD_ICONS = {
  burger: SVG('<path d="M4 10a8 4.5 0 0 1 16 0"/><path d="M4.6 13.6c1.3 1.1 2.5-1 3.8 0s2.5 1.1 3.8 0 2.5-1 3.2 0"/><path d="M5 17h14a1.6 2 0 0 1-1.6 2H6.6A1.6 2 0 0 1 5 17Z"/>'),
  pizza: SVG('<path d="M4 7c5-3 11-3 16 0l-7 13a1 1 0 0 1-2 0Z"/><circle cx="10" cy="9.5" r="1.1"/><circle cx="14" cy="10.5" r="1.1"/><circle cx="12" cy="14" r="1.1"/>'),
  chicken: SVG('<path d="M14 4.2a4.7 4.7 0 0 0-6 6.9l-3 3a2.1 2.1 0 1 0 1.9 1.9l3-3a4.7 4.7 0 0 0 6.9-6"/><path d="M5.4 15.1 3.5 16.4M7.6 17.3 6.3 19.2"/>'),
  nuggets: SVG('<path d="M8 5.5c2.3 0 3.7 1.3 3.7 3s-1.4 3-3.7 3-3.7-1.3-3.7-3S5.7 5.5 8 5.5Z"/><path d="M15 11c2.3 0 3.8 1.4 3.8 3.2s-1.5 3.3-3.8 3.3-3.8-1.5-3.8-3.3S12.7 11 15 11Z"/>'),
  fries: SVG('<path d="M6.5 10 7.5 19a2 2 0 0 0 2 1.8h5A2 2 0 0 0 16.5 19l1-9Z"/><path d="M9.5 10V5M12 10V4M14.5 10V6"/>'),
  drink: SVG('<path d="M7 8h10l-1 11a2 2 0 0 1-2 1.8H10A2 2 0 0 1 8 19Z"/><path d="M8.2 11.5h7.6"/><path d="M13 8l2-3.5"/>'),
  coffee: SVG('<path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z"/><path d="M16 10.5h1.8a2 2 0 0 1 0 4H16"/><path d="M8 3.5v2M11 3.5v2"/>'),
  shake: SVG('<path d="M7.2 10h9.6l-1 9a2 2 0 0 1-2 1.8h-3.6a2 2 0 0 1-2-1.8Z"/><path d="M7 10a5 3 0 0 1 10 0"/><path d="M12 4.5V10"/>'),
  icecream: SVG('<path d="M8.4 11 12 20.5 15.6 11Z"/><path d="M7.8 11a4.2 4.2 0 0 1 8.4 0"/><path d="M9 8.2a3 3 0 0 1 6 0"/>'),
  wrap: SVG('<path d="M7.2 4 17 6l-2.6 14L4.5 18Z"/><path d="M7.2 4 6 7.2M9.4 4.4 8.2 7.6M11.6 4.9l-1.2 3.2"/>'),
  sub: SVG('<path d="M3 12a3.2 3.2 0 0 1 3.2-3.2h11.6a3.2 3.2 0 0 1 0 6.4H6.2A3.2 3.2 0 0 1 3 12Z"/><path d="M6.5 11.2c2 1.4 4-1.4 6 0s4-1.4 6 0"/>'),
  salad: SVG('<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path d="M8 11c-1-3 1-5 3.2-5M12 11c0-3 2.2-4.2 4.2-4M12.5 11c1-2 3-3 4.3-2.2"/>'),
  breakfast: SVG('<path d="M9 5.4c3-1.1 6 .4 6.6 3 3 .6 3.4 4.2.8 5.6.4 3-3.2 4.6-6.2 3-3 1.4-6.6-1-5.4-4-2.6-2 .2-6.2 4.2-7.6Z"/><circle cx="11" cy="11.4" r="2.3" fill="currentColor" stroke="none"/>'),
  sauce: SVG('<path d="M10 3.5h4v2l1 1.8V19a1.8 1.8 0 0 1-1.8 1.8h-2.4A1.8 1.8 0 0 1 9 19V7.3Z"/><path d="M9.2 11h5.6"/>'),
  dessert: SVG('<path d="M6.5 11h11l-1.4 8a2 2 0 0 1-2 1.7h-4.2a2 2 0 0 1-2-1.7Z"/><path d="M6 11a6 3.5 0 0 1 12 0"/><path d="M12 4.5V7"/><circle cx="12" cy="4" r="1"/>'),
  meal: SVG('<path d="M6.5 8.5h11l-1 10.5a2 2 0 0 1-2 1.8H9.5a2 2 0 0 1-2-1.8Z"/><path d="M9 8.5V6.5a3 3 0 0 1 6 0v2"/>')
};
const foodIcon = r => `<span class="ficon" aria-hidden="true">${FOOD_ICONS[r.type] || FOOD_ICONS.meal}</span>`;

// Look up a chain+item's makeup. Falls back to the base name (strips a trailing
// "(Large)" etc.) so Domino's per-size rows match their per-product ingredients.
function itemInfo(brand, item) {
  const byBrand = ingredients[brand];
  if (!byBrand) return null;
  return byBrand[item] || byBrand[item.replace(/\s*\([^)]*\)\s*$/, '').trim()] || null;
}

// One list row. mode: 'value' (per dollar), 'total' (per item) or 'price'.
function rowHtml(r, n, { field, mode = 'value', max = 0, context = 'c' }) {
  const v = mode === 'value' ? perDollar(r, field) : mode === 'total' ? r[field] : r.price;
  const width = !max || !v ? 0 : mode === 'price' ? Math.max(3, Math.round((max / v) * 100)) : Math.max(3, Math.round((v / max) * 100));
  let main, sub;
  if (mode === 'price' || !field) {
    main = `<span class="m">${fmtMoney(r.price)}</span>`;
    sub = r.kj ? FIELD[energyField()].amount(r[energyField()]) : 'no energy data';
  } else if (!r[field]) {
    main = `<span class="m">${fmtMoney(r.price)}</span>`;
    sub = `<span class="na">no ${FIELD[field].short} data</span>`;
  } else if (mode === 'total') {
    main = `<span class="m">${FIELD[field].num.format(r[field])} <span class="u">${FIELD[field].unit}</span></span>`;
    sub = `${fmtMoney(r.price)} · ${FIELD[field].rate.format(perDollar(r, field))} ${FIELD[field].per}`;
  } else {
    main = `<span class="m">${FIELD[field].rate.format(v)} <span class="u">${FIELD[field].per}</span></span>`;
    sub = `${fmtMoney(r.price)} · ${FIELD[field].amount(r[field])}`;
  }
  const badges = [];
  if (r.bundle) badges.push('<span class="badge deal">deal</span>');
  const src = field && r.sourced[field];
  if (src) badges.push(`<span class="badge src" title="${escapeHtml(`${FIELD[field].short} ${src}`)}">${escapeHtml(`${FIELD[field].short} ${src.replace(/ of the same item$/, '')}`)}</span>`);
  if (r.edited) badges.push('<span class="badge">edited</span>');
  const detailId = `det-${context}-${r.idx}`;
  return `<li class="row${n && n <= 3 && mode !== 'none' ? ' top' : ''}${r.edited ? ' edited' : ''}">
    ${width ? `<span class="meter-bar" style="width:${width}%" aria-hidden="true"></span>` : ''}
    <span class="rk">${n || '–'}</span>
    <div class="main">
      <div class="name">${foodIcon(r)}<span>${escapeHtml(r.name)}</span></div>
      <div class="meta">${brandTag(r.brand)}<span>${escapeHtml(r.category)}</span>${badges.join('')}
        <button class="row-btn" type="button" data-detail="${r.idx}" aria-expanded="false" aria-controls="${detailId}">Details</button>
        <button class="row-btn" type="button" data-edit="${escapeHtml(r.id)}">Edit<span class="sr-only"> ${escapeHtml(r.name)}</span></button>
      </div>
    </div>
    <div class="val">${main}<div class="price">${sub}</div></div>
    <div class="row-detail" id="${detailId}" hidden></div>
  </li>`;
}

function detailHtml(r) {
  const parts = [];
  const line = (label, text) => `<div class="mk-row"><span class="mk-label">${label}</span> ${text}</div>`;
  if (r.kj) {
    const note = r.sourced.kj ? ` <span class="mk-src">(${escapeHtml(r.sourced.kj)})</span>` : '';
    parts.push(line('Energy', `${n0.format(r.kj)} kJ · ${n0.format(r.cal)} Cal · ${pct.format(r.kj / DAILY_KJ)} of an average day${note}`));
    if (r.price) parts.push(line('Day of food', `${money.format((r.price * DAILY_KJ) / r.kj)} buys 8,700 kJ of this`));
  } else {
    parts.push(line('Energy', 'not published by the chain'));
  }
  const nut = [];
  if (r.protein) nut.push(`${n1.format(r.protein)} g protein`);
  if (r.satFat !== null) nut.push(`${n1.format(r.satFat)} g sat fat`);
  if (r.sugars !== null) nut.push(`${n1.format(r.sugars)} g sugars`);
  if (r.sodium !== null) nut.push(`${n0.format(r.sodium)} mg sodium`);
  if (r.grams) nut.push(`${n0.format(r.grams)} g serve`);
  if (nut.length) parts.push(line('Nutrition', `${nut.join(' · ')} <span class="mk-src">per serve</span>`));
  const info = itemInfo(r.brand, r.name);
  if (info?.ingredients?.length) parts.push(line(info.ingredientsNote?.includes('combo') ? 'Includes' : 'Made with', info.ingredients.map(escapeHtml).join(', ')));
  if (info?.allergens?.length) parts.push(line('Allergens', info.allergens.map(escapeHtml).join(', ')));
  const where = [r.src.storeLabel && `Priced at ${r.src.storeLabel}`, r.src.sourceFile].filter(Boolean).map(escapeHtml).join(' · ');
  if (where || info?.source) parts.push(`<div class="mk-src">${[where, info?.source && escapeHtml(info.source)].filter(Boolean).join(' · ')}</div>`);
  return parts.join('');
}
function toggleDetail(btn) {
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  const r = rows[Number(btn.dataset.detail)];
  if (!panel || !r) return;
  if (!panel.dataset.filled) { panel.innerHTML = detailHtml(r); panel.dataset.filled = '1'; }
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

/* ---------- compare ---------- */
function compareRows() {
  const tokens = searchTokens(ui.search);
  const max = Number(ui.maxPrice);
  const minKj = Number(ui.minSize) || 0;
  let sizeUnknown = 0;
  const list = [];
  for (const r of rows) {
    if (!inChannel(r)) continue;
    if (ui.foodOnly && r.kind !== 'food') continue;
    if (ui.brand !== 'all' && r.brand !== ui.brand) continue;
    if (ui.category !== 'all' && r.category !== ui.category) continue;
    if (!matchesType(r, ui.type)) continue;
    if (max > 0 && r.price > max) continue;
    if (tokens.length && !matchesSearch(r, tokens)) continue;
    if (minKj) {
      if (!r.kj) { sizeUnknown += 1; continue; }
      if (r.kj < minKj) continue;
    }
    list.push(r);
  }
  return { list, sizeUnknown };
}

function renderCompare() {
  const field = fieldFor(ui.metric);
  const { list, sizeUnknown } = compareRows();
  const { ranked, unranked } = rank(list, field);
  view.compare = { ranked, unranked, field };
  renderLede(field);
  renderPodium(ranked.slice(0, 3), field);
  renderCoverage(ranked, unranked, field, sizeUnknown);
  renderRankingList();
  renderUnrankedList();
  renderCoverageTable();
  const active = (ui.category !== 'all') + (Number(ui.maxPrice) > 0) + (ui.minSize !== '0') + !ui.foodOnly;
  els.filterCount.hidden = !active;
  els.filterCount.textContent = String(active);
  els.compareStatus.textContent = `${plural(ranked.length, 'item')} ranked${unranked.length ? `, ${n0.format(unranked.length)} without data` : ''}.`;
}

function renderLede(field) {
  const chains = chainsWith(rows.filter(r => inChannel(r) && r.kind === 'food'), field || 'kj');
  const only = chains.length ? `Only ${listOf.format(chains)} publish${chains.length === 1 ? 'es' : ''}` : 'No chain publishes';
  els.lede.innerHTML = {
    kj: 'Ranked by <strong>kilojoules per dollar</strong> — how much food energy each dollar buys. An average adult needs about 8,700 kJ a day.',
    cal: 'Ranked by <strong>Calories per dollar</strong> — how much food energy each dollar buys. An average adult needs about 2,080 Cal a day.',
    protein: `Ranked by <strong>grams of protein per dollar</strong>. ${escapeHtml(only)} protein, so only their items can be compared.`,
    grams: `Ranked by <strong>grams of food per dollar</strong>. ${escapeHtml(only)} serve weights, so only their items can be compared.`
  }[field] || '<strong>Cheapest first.</strong> Energy is shown wherever the chain publishes it.';
}

function renderPodium(top, field) {
  els.podium.innerHTML = top.map((r, i) => {
    const value = field
      ? `<b>${FIELD[field].rate.format(perDollar(r, field))}</b><small>${FIELD[field].per}</small>`
      : `<b>${fmtMoney(r.price)}</b>`;
    const bits = [brandTag(r.brand), `<span>${fmtMoney(r.price)}</span>`];
    if (field) bits.push(`<span>${FIELD[field].amount(r[field])}</span>`);
    if ((field === 'kj' || field === 'cal') && r.kj) bits.push(`<span>a day's food for ${money.format((r.price * DAILY_KJ) / r.kj)}</span>`);
    return `<li class="pick">
      <span class="pick-rank" aria-label="Number ${i + 1}">${i + 1}</span>
      <div class="pick-body"><div class="pick-name">${foodIcon(r)}<span>${escapeHtml(r.name)}</span></div><div class="pick-sub">${bits.join('<span aria-hidden="true">·</span>')}</div></div>
      <div class="pick-val">${value}</div>
    </li>`;
  }).join('');
}

function renderCoverage(ranked, unranked, field, sizeUnknown) {
  const total = ranked.length + unranked.length;
  const notes = [];
  if (field && total) {
    const noun = FIELD[field].noun;
    const cov = coverage([...ranked, ...unranked], field);
    const none = cov.brands.filter(b => !b.have).map(b => b.brand);
    let head = `<strong>Ranking ${n0.format(ranked.length)} of ${plural(total, 'item')}.</strong> `;
    if (unranked.length) {
      head += `${n0.format(unranked.length)} ${unranked.length === 1 ? "doesn't" : "don't"} publish ${noun}`;
      if (none.length && (field === 'kj' || field === 'cal')) head += ` — including every ${escapeHtml(listOf.format(none))} item`;
      head += `, so ${unranked.length === 1 ? 'it isn\'t' : 'they aren\'t'} ranked. <button class="link-btn" type="button" data-show-unranked>See ${unranked.length === 1 ? 'it' : 'them'}</button>`;
    } else {
      head += `Every matching item publishes ${noun}.`;
    }
    notes.push(head);
    const borrowed = ranked.filter(r => r.sourced[field]).length;
    if (borrowed) notes.push(`${plural(borrowed, 'figure')} ${borrowed === 1 ? 'comes' : 'come'} from the same item's listing under the other order type (marked).`);
    const share = ranked.length / total;
    els.coverage.innerHTML = `<div class="coverage-box${share < 0.6 ? ' warn' : ''}">
      <div class="meter" role="img" aria-label="${pct.format(share)} of matching items ranked"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
      ${notes.map(n => `<p>${n}</p>`).join('')}
      ${sizeUnknown ? `<p>The serving-size filter also hides ${plural(sizeUnknown, 'item')} with no published energy.</p>` : ''}
    </div>`;
    return;
  }
  els.coverage.innerHTML = sizeUnknown
    ? `<div class="coverage-box"><p>The serving-size filter hides ${plural(sizeUnknown, 'item')} with no published energy, because their size is unknown.</p></div>`
    : '';
}

function renderRankingList() {
  const { ranked, unranked, field } = view.compare;
  const mode = field ? 'value' : 'price';
  const max = !ranked.length ? 0 : field ? perDollar(ranked[0], field) : ranked[0].price;
  els.ranking.innerHTML = ranked.slice(0, view.shown).map((r, i) => rowHtml(r, i + 1, { field, mode, max, context: 'c' })).join('');
  els.rankingEmpty.hidden = ranked.length > 0;
  els.rankingEmpty.textContent = unranked.length
    ? `None of these items publish ${FIELD[field].noun}. They're listed below.`
    : emptyMessage();
  const left = ranked.length - view.shown;
  els.moreRows.hidden = left <= 0;
  els.moreRows.textContent = `Show ${n0.format(Math.min(PAGE, left))} more of ${n0.format(left)}`;
}
function emptyMessage() {
  if (ui.brand !== 'all' && !rows.some(r => r.brand === ui.brand && r.channel === ui.channel)) {
    return `${ui.brand} has no ${ui.channel} prices in this data. Try the other order type.`;
  }
  return 'No items match these filters.';
}

function renderUnrankedList() {
  const { unranked, field } = view.compare;
  els.unranked.hidden = !unranked.length;
  if (!unranked.length) return;
  const noun = FIELD[field].noun;
  els.unrankedSummary.textContent = `${plural(unranked.length, 'item')} not ranked — no published ${noun}`;
  els.unrankedHint.textContent = `Listed cheapest first. They can't be compared on ${noun} until the chain publishes it, and the site doesn't estimate it.`;
  if (!view.compare.ranked.length) els.unranked.open = true;
  els.unrankedList.innerHTML = unranked.slice(0, view.unrankedShown).map(r => rowHtml(r, 0, { field, mode: 'value', context: 'u' })).join('');
  const left = unranked.length - view.unrankedShown;
  els.moreUnranked.hidden = left <= 0;
  els.moreUnranked.textContent = `Show ${n0.format(Math.min(PAGE, left))} more`;
}

function renderCoverageTable() {
  const live = rows.filter(r => inChannel(r) && r.kind === 'food');
  const fields = [['kj', 'Energy'], ['protein', 'Protein'], ['grams', 'Weight']];
  const per = fields.map(([f]) => coverage(live, f));
  const brands = per[0].brands.map(b => b.brand);
  const cell = (c, brand) => {
    const b = c.brands.find(x => x.brand === brand);
    const share = b.have / b.total;
    return `<td${b.have ? '' : ' class="none"'}>${b.have ? pct.format(share) : '—'}</td>`;
  };
  els.coverageTable.innerHTML = `<caption>Share of each chain's ${ui.channel} food items that publish each figure</caption>
    <thead><tr><th scope="col">Chain</th><th scope="col">Items</th>${fields.map(([, l]) => `<th scope="col">${l}</th>`).join('')}</tr></thead>
    <tbody>${brands.map(brand => `<tr><th scope="row">${escapeHtml(brand)}</th><td>${n0.format(per[0].brands.find(b => b.brand === brand).total)}</td>${per.map(c => cell(c, brand)).join('')}</tr>`).join('')}</tbody>`;
}

/* ---------- budget ---------- */
function syncChips(group, value) {
  $$(`.chips[data-target="${group}"] button`).forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === Number(value))));
}

function renderBudget() {
  const budget = Number(ui.budget);
  syncChips('budget', ui.budget);
  if (!(budget > 0)) {
    els.budgetResult.innerHTML = '<p>Enter a budget to see what fits.</p>';
    els.budgetList.innerHTML = ''; els.budgetNote.textContent = '';
    return;
  }
  const field = fieldFor(ui.budgetMetric);
  const f = FIELD[field];
  const pool = rows.filter(r => inChannel(r) && r.kind === 'food' && r.price <= budget && (ui.budgetBrand === 'all' || r.brand === ui.budgetBrand));
  const withData = pool.filter(r => r[field]);
  const total = ui.budgetSort === 'total';
  withData.sort(total
    ? (a, b) => b[field] - a[field] || a.price - b.price
    : (a, b) => perDollar(b, field) - perDollar(a, field) || a.price - b.price);
  const best = withData[0];
  if (!best) {
    els.budgetResult.innerHTML = `<p>Nothing under ${money.format(budget)} publishes ${f.noun}${ui.budgetBrand !== 'all' ? ` at ${escapeHtml(ui.budgetBrand)}` : ''}.</p>`;
  } else {
    const day = (field === 'kj' || field === 'cal') ? ` — ${pct.format(best.kj / DAILY_KJ)} of an average day` : '';
    const lead = total
      ? `For ${money.format(budget)} or less, the most ${f.most} in one item is <strong>${escapeHtml(best.name)}</strong> ${brandTag(best.brand)}: ${f.amount(best[field])} for ${fmtMoney(best.price)}${day}.`
      : `Best value under ${money.format(budget)}: <strong>${escapeHtml(best.name)}</strong> ${brandTag(best.brand)} at ${f.rate.format(perDollar(best, field))} ${f.per} (${f.amount(best[field])} for ${fmtMoney(best.price)}).`;
    const change = budget - best.price;
    els.budgetResult.innerHTML = `<p>${lead}</p>${change >= 0.05 ? `<p>${money.format(change)} left over — the Combos tab can spend it.</p>` : ''}`;
  }
  const max = best ? (total ? best[field] : perDollar(best, field)) : 0;
  els.budgetList.innerHTML = withData.slice(0, 15).map((r, i) => rowHtml(r, i + 1, { field, mode: total ? 'total' : 'value', max, context: 'b' })).join('');
  const missing = pool.length - withData.length;
  const none = coverage(pool, field).brands.filter(b => !b.have).map(b => b.brand);
  els.budgetNote.textContent = missing
    ? `${n0.format(withData.length)} of ${plural(pool.length, 'food item')} under ${money.format(budget)} publish ${f.noun} and can be compared${none.length ? `; ${listOf.format(none)} publish${none.length === 1 ? 'es' : ''} none` : ''}. Drinks, sauces and add-ons are left out.`
    : `All ${plural(pool.length, 'food item')} under ${money.format(budget)} publish ${f.noun}. Drinks, sauces and add-ons are left out.`;
}

/* ---------- combos ---------- */
function renderCombos() {
  const budget = Number(ui.comboBudget);
  syncChips('comboBudget', ui.comboBudget);
  if (!(budget > 0)) {
    els.comboResult.innerHTML = '<p>Enter a budget to build combos.</p>';
    els.comboList.innerHTML = ''; els.comboNote.textContent = '';
    return;
  }
  const field = fieldFor(ui.comboMetric);
  const f = FIELD[field];
  const maxItems = Number(ui.comboSize);
  const mode = ui.comboBrand;
  // Drinks and sauces are out; add-ons are in but need a stand-alone item in the same combo.
  const pool = rows.filter(r => inChannel(r) && (r.kind === 'food' || r.kind === 'addon') && r.price <= budget &&
    (mode === 'each' || mode === 'mix' || r.brand === mode));
  const toCand = r => ({ row: r, price: r.price, value: r[field], bundle: r.bundle, addon: r.kind === 'addon' });
  const cands = pool.filter(r => r[field]).map(toCand);
  const opts = { budget, maxItems };

  let cards = [];
  if (mode === 'each') {
    const byBrand = new Map();
    for (const c of cands) (byBrand.get(c.row.brand) || byBrand.set(c.row.brand, []).get(c.row.brand)).push(c);
    for (const [brand, list] of byBrand) {
      const res = bestCombos(list, opts);
      if (res) cards.push({ title: brand, combo: res.best, alt: res.cheaper });
    }
    cards.sort((a, b) => b.combo.value - a.combo.value);
  } else {
    const res = bestCombos(cands, opts);
    if (res) {
      cards.push({ title: 'Best combo', combo: res.best });
      if (res.cheaper) cards.push({ title: 'Almost as much for less', combo: res.cheaper });
      const seen = new Set(cards.map(c => comboKey(c.combo)));
      for (const b of res.bySize) {
        if (seen.has(comboKey(b))) continue;
        seen.add(comboKey(b));
        cards.push({ title: `Best with ${b.items.length} items`, combo: b });
      }
    }
  }

  const where = mode === 'each' ? 'at any one chain' : mode === 'mix' ? 'mixing chains' : `at ${escapeHtml(mode)}`;
  const best = cards[0]?.combo;
  if (!best) {
    els.comboResult.innerHTML = `<p>No combo of 2–${maxItems} items with published ${f.noun} fits under ${money.format(budget)} ${where}.</p>`;
  } else {
    const chain = mode === 'each' ? `${brandTag(cards[0].title)} ` : '';
    els.comboResult.innerHTML = `<p>Most ${f.most} for ${money.format(budget)} ${where}: ${chain}<strong>${f.amount(best.value)}</strong> for ${money.format(best.price)}${(field === 'kj' || field === 'cal') ? ` — ${pct.format(best.value / DAY[field])} of an average day` : ''}.</p>`;
  }
  els.comboList.innerHTML = cards.map((card, i) => comboCard(card, i, field, mode === 'each')).join('');

  const excluded = pool.length - cands.length;
  const none = coverage(pool, field).brands.filter(b => !b.have).map(b => b.brand);
  els.comboNote.textContent = `Every combination of up to ${maxItems} different items under ${money.format(budget)} is checked, so these are the true best — not a shortlist.`
    + (excluded ? ` ${plural(excluded, 'item')} without published ${f.noun} can't be included${none.length ? ` (${listOf.format(none)} publish${none.length === 1 ? 'es' : ''} none)` : ''}.` : '')
    + ' Add-ons count only alongside a stand-alone item.';
}
const comboKey = c => c.items.map(i => i.row.idx).sort((a, b) => a - b).join('|');

function comboCard({ title, combo, alt }, i, field, perChain) {
  const f = FIELD[field];
  const day = (field === 'kj' || field === 'cal') ? ` · ${pct.format(combo.value / DAY[field])} of a day` : '';
  const tag = perChain ? `#${i + 1} ${brandTag(title)}` : escapeHtml(title);
  const altLine = alt
    ? `<p class="combo-alt">Spend ${money.format(combo.price - alt.price)} less: <b>${alt.items.map(it => escapeHtml(it.row.name)).join(' + ')}</b> gets ${pct.format(alt.value / combo.value)} of this for ${money.format(alt.price)}.</p>`
    : '';
  return `<article class="combo-card${i === 0 ? ' best' : ''}">
    <div class="combo-head">
      <div><div class="combo-tag">${tag}</div><h3>${f.amount(combo.value)}</h3>
        <p class="combo-sub">${f.rate.format(combo.value / combo.price)} ${f.per}${day}</p></div>
      <div class="combo-price"><b>${money.format(combo.price)}</b><small>${plural(combo.items.length, 'item')}</small></div>
    </div>
    <ul class="combo-items">${combo.items.map(it => `<li data-row="${it.row.idx}">${foodIcon(it.row)}<span>${escapeHtml(it.row.name)}${perChain ? '' : ` ${brandTag(it.row.brand)}`}${it.bundle ? ' <span class="badge deal">deal</span>' : ''}</span><span class="ci-meta">${fmtMoney(it.price)} · ${f.amount(it.value)}</span></li>`).join('')}</ul>
    ${altLine}
  </article>`;
}

/* ---------- manage ---------- */
function loadOverlay() {
  const saved = store.json(EDITS_KEY, null);
  if (saved && typeof saved === 'object') {
    return { edits: saved.edits || {}, deleted: Array.isArray(saved.deleted) ? saved.deleted : [], imported: Array.isArray(saved.imported) ? saved.imported : null };
  }
  // v8 kept a full copy of the data, which froze every price at the day of the first edit.
  // Keep only the rows the user actually changed, laid over the current published row.
  const fresh = { edits: {}, deleted: [], imported: null };
  const legacy = store.json(LEGACY_ITEMS_KEY, null);
  if (Array.isArray(legacy?.items)) {
    const byId = new Map(seed.items.map(i => [i.id, i]));
    for (const it of legacy.items) if (it?.userEdited && it.id) fresh.edits[it.id] = { ...(byId.get(it.id) || {}), ...it };
    if (store.set(EDITS_KEY, JSON.stringify(fresh))) store.remove(LEGACY_ITEMS_KEY);
  }
  return fresh;
}
function persist() {
  const empty = !Object.keys(overlay.edits).length && !overlay.deleted.length && !overlay.imported;
  if (empty) { store.remove(EDITS_KEY); return true; }
  return store.set(EDITS_KEY, JSON.stringify(overlay));
}

function renderManage() {
  const changed = Object.keys(overlay.edits).length, deleted = overlay.deleted.length;
  const active = Boolean(overlay.imported || changed || deleted);
  els.localState.classList.toggle('active', active);
  els.localState.textContent = overlay.imported
    ? `Using an imported file of ${plural(overlay.imported.length, 'item')}${changed || deleted ? `, plus ${plural(changed, 'edit')} and ${plural(deleted, 'deletion')}` : ''}. Reset to go back to the published data.`
    : active
      ? `${plural(changed, 'local edit')} and ${plural(deleted, 'deletion')} on top of the published data (${plural(seed.items.length, 'item')}).`
      : `No local edits — showing the published data (${plural(seed.items.length, 'item')}).`;
  renderFinder();
}

function renderFinder() {
  const tokens = searchTokens(els.findItem.value);
  if (!tokens.length) { els.findResults.innerHTML = ''; return; }
  const found = rows.filter(r => matchesSearch(r, tokens)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  els.findResults.innerHTML = found.length
    ? found.map(r => `<li><button type="button" data-edit="${escapeHtml(r.id)}">${escapeHtml(r.name)}<small>${escapeHtml(r.brand)} · ${escapeHtml(r.category)} · ${r.channel} · ${fmtMoney(r.price)}</small></button></li>`).join('')
    : '<li class="hint">No matching items.</li>';
}

function editItem(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  showTab('manage');
  editingId = id;
  els.formTitle.textContent = `Edit ${it.item}`;
  els.itemId.value = id;
  const val = v => (v === null || v === undefined ? '' : v);
  els.itemName.value = val(it.item); els.itemBrand.value = val(it.brand); els.itemCategory.value = val(it.category);
  els.itemChannel.value = channelOf(it) === 'delivery' ? 'Delivery' : 'Pickup';
  els.itemPrice.value = val(it.price); els.itemServe.value = val(it.serveGrams); els.itemKj.value = val(it.energyKj);
  els.itemCal.value = val(it.energyCal); els.itemProtein.value = val(it.proteinGrams); els.itemNote.value = val(it.note);
  els.deleteItem.disabled = false;
  els.dataStatus.textContent = '';
  els.itemName.focus();
}
function clearForm() {
  editingId = null;
  els.form.reset();
  els.itemId.value = '';
  els.itemChannel.value = ui.channel === 'delivery' ? 'Delivery' : 'Pickup';
  els.formTitle.textContent = 'Add an item';
  els.deleteItem.disabled = true;
}
function saveItemFromForm(e) {
  e.preventDefault();
  const id = els.itemId.value;
  const prev = id ? items.find(i => i.id === id) : null;
  const channel = els.itemChannel.value;
  // Start from the stored row so fields the form doesn't show (sat fat, plu, generatedBy…) survive.
  const item = normaliseItem({
    ...(prev || { sourceFile: 'local edit' }),
    id: id || undefined,
    item: els.itemName.value, brand: els.itemBrand.value, category: els.itemCategory.value,
    channel: prev && channelOf(prev) === channel.toLowerCase() ? prev.channel : channel,
    price: els.itemPrice.value, serveGrams: els.itemServe.value, energyKj: els.itemKj.value,
    energyCal: els.itemCal.value, proteinGrams: els.itemProtein.value, note: els.itemNote.value,
    userEdited: true
  });
  overlay.edits[item.id] = item;
  overlay.deleted = overlay.deleted.filter(x => x !== item.id);
  const kept = persist();
  editingId = item.id; els.itemId.value = item.id; els.deleteItem.disabled = false;
  els.formTitle.textContent = `Edit ${item.item}`;
  refreshData();
  els.dataStatus.textContent = kept ? `Saved ${item.item}. Export the file to update the public site.` : `Saved ${item.item} for this visit only — this browser isn't letting the site store data.`;
}
function deleteCurrentItem() {
  if (!editingId) return;
  const it = items.find(i => i.id === editingId);
  if (!confirm(`Delete ${it?.item || 'this item'} from your local data?`)) return;
  const inBase = (overlay.imported || seed.items).some(i => i.id === editingId);
  delete overlay.edits[editingId];
  if (inBase && !overlay.deleted.includes(editingId)) overlay.deleted.push(editingId);
  persist(); clearForm(); refreshData();
  els.dataStatus.textContent = `Deleted ${it?.item || 'the item'} locally.`;
}
function exportJson() {
  // Same top-level keys and order as the published file; the page's own flags are stripped.
  const payload = {};
  for (const key of new Set(['metadata', 'items', ...Object.keys(seed)])) {
    if (key === 'metadata') payload.metadata = { ...(seed.metadata || {}), exportedAt: new Date().toISOString() };
    else if (key === 'items') payload.items = items.map(exportItem);
    else payload[key] = seed[key];
  }
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'foods.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  els.dataStatus.textContent = `Exported foods.json with ${plural(items.length, 'item')}.`;
}
function importData(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { els.dataStatus.textContent = `Import failed: that isn't valid JSON (${err.message}).`; return; }
  const list = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(list)) { els.dataStatus.textContent = 'Import failed: the file needs an "items" array.'; return; }
  const valid = list.filter(i => i && typeof i === 'object' && (i.item || i.brand));
  if (!valid.length) { els.dataStatus.textContent = 'Import failed: no items with a name or chain were found.'; return; }
  overlay = { edits: {}, deleted: [], imported: valid.map(normaliseItem) };
  const kept = persist();
  clearForm(); refreshData();
  els.importText.value = '';
  const skipped = list.length - valid.length;
  els.dataStatus.textContent = `Imported ${plural(valid.length, 'item')}${skipped ? ` (skipped ${n0.format(skipped)} without a name)` : ''}${kept ? '' : ' for this visit only — the file is too large for this browser\'s storage'}.`;
}
function resetLocalEdits() {
  if (!confirm('Reset all local edits and imports back to the published data?')) return;
  overlay = { edits: {}, deleted: [], imported: null };
  store.remove(EDITS_KEY);
  clearForm(); refreshData();
  els.dataStatus.textContent = 'Local edits reset.';
}

init().catch(err => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'coverage-box warn';
  box.style.margin = '1rem';
  box.textContent = `Failed to load the menu data: ${err.message}`;
  document.body.prepend(box);
});
window.__fastFoodValue = { get rows() { return rows; }, get ui() { return { ...ui }; }, bestCombos };
