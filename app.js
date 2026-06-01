const DATA_URL = 'data/foods.json';
const STORAGE_KEY = 'au-fast-food-value.items.v6';
const BUDGET_KEY = 'au-fast-food-value.budget.v1';
const COMBO_KEY = 'au-fast-food-value.combo.v1';
const THEME_KEY = 'au-fast-food-value.theme.v1';

const els = {
  heroBest: document.querySelector('#heroBest'), search: document.querySelector('#searchInput'), brand: document.querySelector('#brandFilter'),
  category: document.querySelector('#categoryFilter'), metric: document.querySelector('#metricSelect'), sort: document.querySelector('#sortSelect'),
  maxPrice: document.querySelector('#maxPrice'), quickStats: document.querySelector('#quickStats'), body: document.querySelector('#itemsBody'),
  cards: document.querySelector('#cardGrid'), budget: document.querySelector('#budgetInput'), budgetMetric: document.querySelector('#budgetMetric'),
  budgetSummary: document.querySelector('#budgetSummary'), budgetList: document.querySelector('#budgetList'), comboBudget: document.querySelector('#comboBudget'),
  comboBrand: document.querySelector('#comboBrand'), comboSize: document.querySelector('#comboSize'), comboMetric: document.querySelector('#comboMetric'),
  comboSummary: document.querySelector('#comboSummary'), comboList: document.querySelector('#comboList'), form: document.querySelector('#itemForm'),
  formTitle: document.querySelector('#formTitle'), itemId: document.querySelector('#itemId'), itemName: document.querySelector('#itemName'), itemBrand: document.querySelector('#itemBrand'),
  itemCategory: document.querySelector('#itemCategory'), itemPrice: document.querySelector('#itemPrice'), itemServe: document.querySelector('#itemServe'),
  itemKj: document.querySelector('#itemKj'), itemCal: document.querySelector('#itemCal'), itemProtein: document.querySelector('#itemProtein'), itemNote: document.querySelector('#itemNote'),
  deleteItem: document.querySelector('#deleteItem'), newItem: document.querySelector('#newItem'), exportJson: document.querySelector('#exportJson'),
  importText: document.querySelector('#importText'), importJson: document.querySelector('#importJson'), resetEdits: document.querySelector('#resetEdits'),
  dataStatus: document.querySelector('#dataStatus'), brandList: document.querySelector('#brandList'), categoryList: document.querySelector('#categoryList'),
  themeToggle: document.querySelector('#themeToggle')
};

let seed = { metadata: {}, items: [] };
let items = [];
let editingId = null;

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const n0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}
function asNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}
function round(value, digits = 2) { return hasNumber(value) ? Number(Math.round(`${Number(value)}e${digits}`) + `e-${digits}`) : null; }
function fmtNumber(value, formatter = n1, suffix = '') { return hasNumber(value) && Number(value) > 0 ? `${formatter.format(Number(value))}${suffix}` : '—'; }
function slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID(); }
function withMetrics(item) {
  const price = asNum(item.price);
  return {
    ...item,
    price,
    gramsPerDollar: price && hasNumber(item.serveGrams) ? asNum(item.serveGrams) / price : 0,
    kjPerDollar: price && hasNumber(item.energyKj) ? asNum(item.energyKj) / price : 0,
    calPerDollar: price && hasNumber(item.energyCal) ? asNum(item.energyCal) / price : 0,
    proteinPerDollar: price && hasNumber(item.proteinGrams) ? asNum(item.proteinGrams) / price : 0
  };
}
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ metadata: { ...seed.metadata, locallyEdited: new Date().toISOString() }, items }));
}
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function metricLabel(metric) {
  return ({ gramsPerDollar: 'g/$', kjPerDollar: 'kJ/$', calPerDollar: 'Cal/$', proteinPerDollar: 'protein g/$', price: 'price' })[metric] || metric;
}
function formatMetric(item, metric) {
  if (metric === 'price') return money.format(item.price);
  const value = item[metric];
  return value > 0 ? (metric === 'proteinPerDollar' || metric === 'gramsPerDollar' || metric === 'calPerDollar' ? n1.format(value) : n0.format(value)) : '—';
}

async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL}: ${res.status}`);
  seed = await res.json();
  const local = loadLocal();
  items = (local?.items?.length ? local.items : seed.items).map(normaliseItem);
  els.dataStatus.textContent = local?.items?.length ? 'Using locally edited data. Export it to update the repo.' : `Loaded ${items.length} seed items from data/foods.json.`;
  const budgetState = JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}');
  if (budgetState.budget) els.budget.value = budgetState.budget;
  if (budgetState.metric) els.budgetMetric.value = budgetState.metric;
  const comboState = JSON.parse(localStorage.getItem(COMBO_KEY) || '{}');
  if (comboState.budget) els.comboBudget.value = comboState.budget;
  if (comboState.brand) els.comboBrand.value = comboState.brand;
  if (comboState.size) els.comboSize.value = comboState.size;
  if (comboState.metric) els.comboMetric.value = comboState.metric;
  bindEvents();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(console.warn);
}
function normaliseItem(item) {
  const id = item.id || slug(`${item.brand}-${item.item}`);
  return { id, brand: item.brand || 'Other', item: item.item || 'Untitled item', category: item.category || 'Other', note: item.note || '', price: round(item.price) ?? 0, serveGrams: round(item.serveGrams, 1), energyKj: round(item.energyKj), energyCal: round(item.energyCal), proteinGrams: round(item.proteinGrams, 1), sourceFile: item.sourceFile || 'local', userEdited: Boolean(item.userEdited) };
}
function bindEvents() {
  ['input', 'change'].forEach(evt => {
    [els.search, els.brand, els.category, els.metric, els.sort, els.maxPrice].forEach(el => el.addEventListener(evt, renderAll));
    [els.budget, els.budgetMetric].forEach(el => el.addEventListener(evt, () => { localStorage.setItem(BUDGET_KEY, JSON.stringify({ budget: els.budget.value, metric: els.budgetMetric.value })); renderBudget(); }));
    [els.comboBudget, els.comboBrand, els.comboSize, els.comboMetric].forEach(el => el.addEventListener(evt, () => { localStorage.setItem(COMBO_KEY, JSON.stringify({ budget: els.comboBudget.value, brand: els.comboBrand.value, size: els.comboSize.value, metric: els.comboMetric.value })); renderCombos(); }));
  });
  els.body.addEventListener('click', e => { const btn = e.target.closest('button[data-edit]'); if (btn) editItem(btn.dataset.edit); });
  els.cards.addEventListener('click', e => { const btn = e.target.closest('button[data-edit]'); if (btn) editItem(btn.dataset.edit); });
  els.form.addEventListener('submit', saveItemFromForm);
  els.newItem.addEventListener('click', clearForm);
  els.deleteItem.addEventListener('click', deleteCurrentItem);
  els.exportJson.addEventListener('click', exportJson);
  els.importJson.addEventListener('click', importJson);
  els.resetEdits.addEventListener('click', resetLocalEdits);
  els.themeToggle.addEventListener('click', () => applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark'));
}
function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(THEME_KEY, theme);
  els.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function renderAll() { populateFilters(); const rows = getFilteredRows(); renderStats(rows); renderHero(rows); renderTable(rows); renderCards(rows); renderBudget(); renderCombos(); }
function populateFilters() {
  const selectedBrand = els.brand.value, selectedCat = els.category.value, selectedComboBrand = els.comboBrand.value;
  fillSelect(els.brand, ['all', ...new Set(items.map(i => i.brand).sort())], selectedBrand, 'All brands');
  fillSelect(els.comboBrand, ['all', ...new Set(items.map(i => i.brand).sort())], selectedComboBrand, 'Any brand');
  fillSelect(els.category, ['all', ...new Set(items.map(i => i.category).sort())], selectedCat, 'All categories');
  fillDatalist(els.brandList, [...new Set(items.map(i => i.brand).sort())]);
  fillDatalist(els.categoryList, [...new Set(items.map(i => i.category).sort())]);
}
function fillSelect(sel, vals, previous, allLabel) {
  sel.innerHTML = vals.map(v => `<option value="${escapeHtml(v)}">${v === 'all' ? allLabel : escapeHtml(v)}</option>`).join('');
  if (vals.includes(previous)) sel.value = previous;
}
function fillDatalist(dl, vals) { dl.innerHTML = vals.map(v => `<option value="${escapeHtml(v)}"></option>`).join(''); }
function getFilteredRows() {
  const query = els.search.value.trim().toLowerCase();
  const max = Number(els.maxPrice.value);
  const metric = els.metric.value;
  let rows = items.map(withMetrics).filter(i => {
    const q = `${i.item} ${i.brand} ${i.category} ${i.note}`.toLowerCase();
    return (!query || q.includes(query)) && (els.brand.value === 'all' || i.brand === els.brand.value) && (els.category.value === 'all' || i.category === els.category.value) && (!Number.isFinite(max) || max <= 0 || i.price <= max);
  });
  const sorters = {
    metricDesc: (a,b) => metric === 'price' ? a.price - b.price : b[metric] - a[metric],
    priceAsc: (a,b) => a.price - b.price,
    brandAsc: (a,b) => `${a.brand} ${a.item}`.localeCompare(`${b.brand} ${b.item}`),
    nameAsc: (a,b) => a.item.localeCompare(b.item)
  };
  return rows.sort(sorters[els.sort.value] || sorters.metricDesc);
}
function renderStats(rows) {
  const avgPrice = rows.reduce((s,i)=>s+i.price,0) / (rows.length || 1);
  const best = rows[0];
  els.quickStats.innerHTML = [
    ['Items shown', n0.format(rows.length)], ['Average price', money.format(avgPrice || 0)],
    ['Best brand', best ? best.brand : '—'], ['Best metric', best ? `${formatMetric(best, els.metric.value)} ${metricLabel(els.metric.value)}` : '—']
  ].map(([k,v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
}
function renderHero(rows) {
  const best = rows[0];
  els.heroBest.innerHTML = best ? `<strong>${escapeHtml(best.item)}</strong><span>${escapeHtml(best.brand)} · ${money.format(best.price)} · ${formatMetric(best, els.metric.value)} ${metricLabel(els.metric.value)}</span>` : 'No matching items.';
}
function renderTable(rows) {
  els.body.innerHTML = rows.map(i => `<tr class="${i.userEdited ? 'changed' : ''}"><td class="food-cell"><strong>${escapeHtml(i.item)}</strong><span>${escapeHtml(i.note || '')}</span></td><td>${escapeHtml(i.brand)}</td><td>${escapeHtml(i.category)}</td><td>${money.format(i.price)}</td><td>${fmtNumber(i.serveGrams, n0, 'g')}</td><td>${formatMetric(i, 'gramsPerDollar')}</td><td>${formatMetric(i, 'kjPerDollar')}</td><td>${formatMetric(i, 'calPerDollar')}</td><td>${formatMetric(i, 'proteinPerDollar')}</td><td><button class="small-button" data-edit="${escapeHtml(i.id)}" type="button">Edit</button></td></tr>`).join('');
}
function renderCards(rows) {
  els.cards.innerHTML = rows.map(i => `<article class="food-card ${i.userEdited ? 'changed' : ''}"><p class="eyebrow">${escapeHtml(i.brand)} · ${escapeHtml(i.category)}</p><h3>${escapeHtml(i.item)}</h3><p class="muted">${escapeHtml(i.note || '')}</p><div class="metric-grid"><div class="metric"><span>Price</span><b>${money.format(i.price)}</b></div><div class="metric"><span>Serve</span><b>${fmtNumber(i.serveGrams, n0, 'g')}</b></div><div class="metric"><span>g/$</span><b>${formatMetric(i, 'gramsPerDollar')}</b></div><div class="metric"><span>Protein/$</span><b>${formatMetric(i, 'proteinPerDollar')}</b></div></div><button class="small-button" data-edit="${escapeHtml(i.id)}" type="button">Edit item</button></article>`).join('');
}
function renderBudget() {
  const budget = Number(els.budget.value);
  const metric = els.budgetMetric.value;
  if (!Number.isFinite(budget) || budget <= 0) { els.budgetSummary.textContent = 'Enter a budget to see matching items.'; els.budgetList.innerHTML = ''; return; }
  const matches = getFilteredRows().filter(i => i.price <= budget).sort((a,b) => b[metric] - a[metric]).slice(0, 8);
  const best = matches[0];
  els.budgetSummary.innerHTML = best ? `Best under ${money.format(budget)}: <strong>${escapeHtml(best.item)}</strong> from ${escapeHtml(best.brand)} (${formatMetric(best, metric)} ${metricLabel(metric)}).` : `No filtered items fit under ${money.format(budget)}.`;
  els.budgetList.innerHTML = matches.map(i => `<div class="budget-item"><div><strong>${escapeHtml(i.item)}</strong><div class="muted">${escapeHtml(i.brand)} · ${escapeHtml(i.category)} · ${formatMetric(i, metric)} ${metricLabel(metric)}</div></div><b>${money.format(i.price)}</b></div>`).join('');
}
function comboMetricLabel(metric) {
  return ({ serveGrams: 'grams', energyKj: 'kJ', energyCal: 'Cal', proteinGrams: 'protein g' })[metric] || metric;
}
function comboMetricValue(combo, metric) {
  return combo.totals[metric] || 0;
}
function comboItemMetric(item, metric) {
  return hasNumber(item[metric]) ? Number(item[metric]) : 0;
}
function renderCombos() {
  const budget = Number(els.comboBudget.value);
  const metric = els.comboMetric.value;
  const brand = els.comboBrand.value;
  const maxItems = Math.max(2, Math.min(4, Number(els.comboSize.value) || 3));
  if (!Number.isFinite(budget) || budget <= 0) { els.comboSummary.textContent = 'Enter a combo budget to find meal combinations.'; els.comboList.innerHTML = ''; return; }
  const ignored = new Set(['Drink', 'Sauce']);
  const bundleCategories = new Set(['Meal Deal', 'Boxed Meal', 'Shared Meal']);
  const rawCandidates = items.map(withMetrics).filter(i => i.price > 0 && i.price <= budget && !ignored.has(i.category) && (brand === 'all' || i.brand === brand) && comboItemMetric(i, metric) > 0);
  const byValue = [...rawCandidates].sort((a,b) => comboItemMetric(b, metric) / b.price - comboItemMetric(a, metric) / a.price).slice(0, 36);
  const byCheap = [...rawCandidates].sort((a,b) => a.price - b.price).slice(0, 18);
  const candidates = [...new Map([...byValue, ...byCheap].map(i => [i.id, i])).values()].sort((a,b) => a.price - b.price);
  const combos = [];
  function addCombo(picks) {
    const totals = picks.reduce((acc, i) => {
      acc.price += i.price;
      acc.serveGrams += comboItemMetric(i, 'serveGrams');
      acc.energyKj += comboItemMetric(i, 'energyKj');
      acc.energyCal += comboItemMetric(i, 'energyCal');
      acc.proteinGrams += comboItemMetric(i, 'proteinGrams');
      return acc;
    }, { price: 0, serveGrams: 0, energyKj: 0, energyCal: 0, proteinGrams: 0 });
    if (picks.length >= 2 && totals.price <= budget && comboMetricValue({ totals }, metric) > 0) combos.push({ items: [...picks], totals });
  }
  function walk(start, picks, price) {
    if (picks.length >= 2) addCombo(picks);
    if (picks.length >= maxItems) return;
    for (let idx = start; idx < candidates.length; idx += 1) {
      const item = candidates[idx];
      if (price + item.price > budget) continue;
      if (bundleCategories.has(item.category) && picks.some(p => bundleCategories.has(p.category))) continue;
      picks.push(item);
      walk(idx + 1, picks, price + item.price);
      picks.pop();
    }
  }
  walk(0, [], 0);
  const unique = [...new Map(combos.map(c => [c.items.map(i => i.id).sort().join('|'), c])).values()]
    .sort((a,b) => comboMetricValue(b, metric) - comboMetricValue(a, metric) || (comboMetricValue(b, metric) / b.totals.price) - (comboMetricValue(a, metric) / a.totals.price) || a.totals.price - b.totals.price)
    .slice(0, 8);
  const best = unique[0];
  els.comboSummary.innerHTML = best ? `Best ${maxItems}-item-or-less combo under ${money.format(budget)}: <strong>${n0.format(comboMetricValue(best, metric))} ${comboMetricLabel(metric)}</strong> for ${money.format(best.totals.price)}.` : `No 2-${maxItems} item food combos fit under ${money.format(budget)} for the selected brand/metric.`;
  els.comboList.innerHTML = unique.map((combo, index) => {
    const itemList = combo.items.map(i => `<li>${escapeHtml(i.item)} <span>${escapeHtml(i.brand)} · ${money.format(i.price)}</span></li>`).join('');
    return `<article class="combo-card"><div class="combo-rank">#${index + 1}</div><div><h3>${n0.format(comboMetricValue(combo, metric))} ${comboMetricLabel(metric)} · ${money.format(combo.totals.price)}</h3><p class="muted">${fmtNumber(combo.totals.serveGrams, n0, 'g')} · ${fmtNumber(combo.totals.energyKj, n0, 'kJ')} · ${fmtNumber(combo.totals.energyCal, n1, 'Cal')} · ${fmtNumber(combo.totals.proteinGrams, n1, 'g protein')}</p><ul>${itemList}</ul></div></article>`;
  }).join('');
}
function editItem(id) {
  const item = items.find(i => i.id === id); if (!item) return;
  editingId = id; els.formTitle.textContent = `Edit ${item.item}`; els.itemId.value = id; els.itemName.value = item.item; els.itemBrand.value = item.brand; els.itemCategory.value = item.category;
  els.itemPrice.value = item.price || ''; els.itemServe.value = item.serveGrams || ''; els.itemKj.value = item.energyKj || ''; els.itemCal.value = item.energyCal || ''; els.itemProtein.value = item.proteinGrams || ''; els.itemNote.value = item.note || '';
  els.deleteItem.disabled = false; document.querySelector('#manage').scrollIntoView({ behavior: 'smooth' });
}
function clearForm() { editingId = null; els.form.reset(); els.formTitle.textContent = 'Add a food item'; els.deleteItem.disabled = true; }
function saveItemFromForm(e) {
  e.preventDefault();
  const existingId = els.itemId.value || `${slug(els.itemBrand.value)}-${slug(els.itemName.value)}-${Date.now().toString(36)}`;
  const item = normaliseItem({ id: existingId, item: els.itemName.value, brand: els.itemBrand.value, category: els.itemCategory.value, price: els.itemPrice.value, serveGrams: els.itemServe.value, energyKj: els.itemKj.value, energyCal: els.itemCal.value, proteinGrams: els.itemProtein.value, note: els.itemNote.value, sourceFile: 'local edit', userEdited: true });
  const index = items.findIndex(i => i.id === existingId);
  if (index >= 0) items[index] = item; else items.unshift(item);
  saveLocal(); editingId = item.id; els.itemId.value = item.id; els.deleteItem.disabled = false; els.dataStatus.textContent = `Saved ${item.item} locally. Export JSON to update the public repo.`; renderAll();
}
function deleteCurrentItem() {
  if (!editingId) return;
  const item = items.find(i => i.id === editingId);
  if (!confirm(`Delete ${item?.item || 'this item'} from your local data?`)) return;
  items = items.filter(i => i.id !== editingId); saveLocal(); clearForm(); renderAll(); els.dataStatus.textContent = 'Item deleted locally.';
}
function exportJson() {
  const payload = { metadata: { ...seed.metadata, exportedAt: new Date().toISOString(), updateInstructions: 'Replace data/foods.json with this file and commit to GitHub Pages.' }, items: items.map(normaliseItem) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = Object.assign(document.createElement('a'), { href: url, download: 'foods.json' });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); els.dataStatus.textContent = 'Exported foods.json.';
}
function importJson() {
  try {
    const parsed = JSON.parse(els.importText.value);
    if (!Array.isArray(parsed.items)) throw new Error('JSON must contain an items array.');
    items = parsed.items.map(i => normaliseItem({ ...i, userEdited: true }));
    saveLocal(); renderAll(); els.dataStatus.textContent = `Imported ${items.length} items locally.`;
  } catch (err) { els.dataStatus.textContent = `Import failed: ${err.message}`; }
}
function resetLocalEdits() {
  if (!confirm('Reset all local edits and return to the repository seed data?')) return;
  localStorage.removeItem(STORAGE_KEY); items = seed.items.map(normaliseItem); clearForm(); renderAll(); els.dataStatus.textContent = 'Local edits reset.';
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[ch])); }

init().catch(err => { console.error(err); document.body.insertAdjacentHTML('afterbegin', `<div class="panel" style="margin:1rem">Failed to load site data: ${escapeHtml(err.message)}</div>`); });
window.__fastFoodValue = { get items(){ return items.map(withMetrics); }, getFilteredRows, exportJson };
