import { evaluateExpression, formatNumber } from './engine.js';
import { mountNotes } from './notes.js';
import { insertCalculatorText, toggleCalculatorSign } from './input.js';

const $ = id => document.getElementById(id);
const HISTORY_KEY = 'calc.history.v1';
const SETTINGS_KEY = 'calc.settings.v1';
const expression = $('expression');
const state = { mode: 'basic', angleMode: 'DEG', committed: false, result: null, entryId: null, carryApproximate: false, filter: 'all', view: 'calc' };
let history = [];
let historyWritable = true;
let historyStorageFailed = false;
let settingsWritable = true;
let editingId = null;
let toastTimer;
let settingsTimer;
let deferredInstall;
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
export function toast(message, undo) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast').hidden = false;
  $('toast-action').hidden = !undo;
  $('toast-action').onclick = undo ? () => { undo(); $('toast').hidden = true; } : null;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 7500 : 4000);
}
function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    if (raw.length > 10000) throw new Error('설정이 너무 큽니다.');
    const settings = JSON.parse(raw);
    if (settings && ['light', 'dark'].includes(settings.theme)) document.body.dataset.theme = settings.theme;
    if (settings && ['basic', 'scientific'].includes(settings.mode)) state.mode = settings.mode;
    if (settings && ['DEG', 'RAD'].includes(settings.angleMode)) state.angleMode = settings.angleMode;
    if (typeof settings?.expression === 'string' && settings.expression.length <= 2048) expression.value = settings.expression;
    state.carryApproximate = settings?.carryApproximate === true;
  } catch { settingsWritable = false; toast('설정을 읽지 못했어요. 이 창에서는 기본 설정으로 사용합니다.'); }
}
function saveSettings() {
  if (!settingsWritable) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, mode: state.mode, angleMode: state.angleMode, expression: expression.value, theme: document.body.dataset.theme || 'light', carryApproximate: state.carryApproximate }));
  } catch { settingsWritable = false; toast('기기에 저장할 공간이 부족해요. 필요한 기록을 내보내 주세요.'); }
}
function queueSettings() { clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettings, 200); }
function historyWarning(message) {
  historyStorageFailed = true;
  $('history-storage-warning').textContent = message;
  $('history-storage-warning').hidden = false;
}
function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    if (raw.length > 3000000) throw new Error('기록이 너무 큽니다.');
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.items) || data.items.length > 5000) throw new Error('알 수 없는 기록입니다.');
    const ids = new Set();
    for (const entry of data.items) {
      if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{1,90}$/.test(entry.id) || ids.has(entry.id) || typeof entry.expression !== 'string' || entry.expression.length > 2048 || typeof entry.value !== 'string' || entry.value.length > 2048 || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(entry.value) || typeof entry.name !== 'string' || entry.name.length > 80 || typeof entry.memo !== 'string' || entry.memo.length > 500 || !['DEG', 'RAD'].includes(entry.angleMode) || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('손상된 기록입니다.');
      ids.add(entry.id);
    }
    history = data.items;
  } catch {
    historyWritable = false;
    historyWarning('저장된 기록을 읽지 못했어요. 원래 데이터는 보존합니다. 이 창에서 새로 만든 기록은 내보내기로 보관해 주세요.');
  }
}
function persistHistory() {
  if (!historyWritable) return false;
  try {
    const raw = JSON.stringify({ version: 1, items: history });
    if (raw.length > 3000000) throw new Error('기록 저장 공간이 가득 찼습니다.');
    localStorage.setItem(HISTORY_KEY, raw);
    historyStorageFailed = false;
    $('history-storage-warning').hidden = true;
    return true;
  } catch {
    historyWarning('기기에 저장하지 못했어요. 이 화면의 기록은 유지됩니다. 창을 닫기 전에 내보내기로 보관해 주세요.');
    return false;
  }
}
function trimHistory() {
  let unsaved = 0;
  history = history.filter(item => item.name || ++unsaved <= 200);
}
function displayResult(result) {
  const display = formatNumber(result.value, { maxFractionDigits: 12 });
  let rounded = result.approximate === true;
  if (!rounded) {
    try { rounded = evaluateExpression(`(${result.value})-(${display.replaceAll(',', '')})`).value !== '0'; }
    catch { rounded = true; }
  }
  return { display, approximate: rounded };
}
function updatePreview(showError = false) {
  state.result = null;
  const text = expression.value.trim();
  const status = $('calculation-status');
  status.classList.remove('error');
  $('precision-label').textContent = state.mode === 'scientific' ? `공학 계산 · ${state.angleMode}` : '십진 계산';
  if (!text) {
    $('result').textContent = '0';
    $('result').className = '';
    $('approximation').hidden = true;
    status.textContent = '숫자판이나 키보드로 입력하세요';
  } else {
    try {
      const evaluated = evaluateExpression(text, { angleMode: state.angleMode });
      if (state.carryApproximate) evaluated.approximate = true;
      state.result = evaluated;
      const { display, approximate } = displayResult(evaluated);
      $('result').textContent = display;
      $('result').className = display.length > 20 ? 'result-small' : display.length > 13 ? 'result-medium' : '';
      $('approximation').hidden = !approximate;
      status.textContent = state.committed
        ? (historyStorageFailed ? '이 창에서만 유지돼요 · 기록을 내보내 주세요' : approximate ? '근삿값 · 계산 기록에 남겼어요' : '계산 기록에 남겼어요')
        : (approximate ? '근삿값 · 소수점 아래 최대 12자리 표시' : '= 을 누르면 기록에 남아요');
    } catch (error) {
      $('result').textContent = '—';
      $('result').className = '';
      $('approximation').hidden = true;
      status.textContent = showError ? error.message : '계산식을 이어서 입력하세요';
      status.classList.toggle('error', showError);
    }
  }
  for (const id of ['save-button', 'copy-button', 'share-button']) $(id).disabled = !state.result;
  queueSettings();
}
function updateModes() {
  $('basic-mode').classList.toggle('selected', state.mode === 'basic');
  $('scientific-mode').classList.toggle('selected', state.mode === 'scientific');
  $('basic-mode').setAttribute('aria-pressed', String(state.mode === 'basic'));
  $('scientific-mode').setAttribute('aria-pressed', String(state.mode === 'scientific'));
  $('scientific-keys').hidden = state.mode !== 'scientific';
  $('angle-button').textContent = state.angleMode;
  $('angle-button').setAttribute('aria-label', `각도 단위: ${state.angleMode}`);
  updatePreview();
}
function normalize(text) { return text.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−'); }
function currentEdit() {
  const start = expression.selectionStart ?? expression.value.length;
  return { value: expression.value, start, end: expression.selectionEnd ?? start, committed: state.committed, result: state.result, carryApproximate: state.carryApproximate };
}
function applyEdit(edit) {
  expression.value = edit.value;
  state.carryApproximate = edit.carryApproximate;
  state.committed = false;
  state.entryId = null;
  expression.focus({ preventScroll: true });
  expression.setSelectionRange(edit.start, edit.end);
  updatePreview();
}
function insert(text) {
  try { applyEdit(insertCalculatorText(currentEdit(), text)); }
  catch (error) { toast(error.message); }
}
function clear() {
  expression.value = '';
  state.committed = false;
  state.entryId = null;
  state.carryApproximate = false;
  updatePreview();
}
function backspace() {
  const start = expression.selectionStart ?? expression.value.length;
  const end = expression.selectionEnd ?? start;
  const cut = start === end ? Math.max(0, start - 1) : start;
  expression.value = expression.value.slice(0, cut) + expression.value.slice(end);
  state.committed = false;
  state.entryId = null;
  if (!expression.value.trim()) state.carryApproximate = false;
  expression.focus({ preventScroll: true });
  expression.setSelectionRange(cut, cut);
  updatePreview();
}
function toggleSign() {
  try { applyEdit(toggleCalculatorSign(currentEdit())); }
  catch (error) { toast(error.message); }
}
function commit() {
  updatePreview(true);
  if (!state.result) return null;
  if (state.committed && state.entryId) {
    const existing = history.find(entry => entry.id === state.entryId);
    if (existing) return existing;
  }
  const entry = { id: uid(), expression: expression.value.trim(), value: state.result.value, approximate: state.result.approximate, angleMode: state.angleMode, name: '', memo: '', createdAt: new Date().toISOString() };
  history.unshift(entry);
  trimHistory();
  state.entryId = entry.id;
  state.committed = true;
  persistHistory();
  renderHistory();
  updatePreview();
  return entry;
}
function humanDate(date) {
  const time = new Date(date);
  const today = new Date().toLocaleDateString('sv-SE');
  const day = time.toLocaleDateString('sv-SE');
  return `${day === today ? '오늘' : time.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} · ${time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
}
function actionButton(label, glyph, handler) {
  const button = element('button', 'icon-button');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(glyph));
  button.addEventListener('click', handler);
  return button;
}
function recall(entry) {
  expression.value = entry.expression;
  state.angleMode = entry.angleMode;
  state.carryApproximate = entry.approximate === true;
  state.committed = false;
  state.entryId = entry.id;
  if (/[a-zπ√^!]/i.test(entry.expression)) state.mode = 'scientific';
  updateModes();
  expression.focus({ preventScroll: true });
  expression.setSelectionRange(expression.value.length, expression.value.length);
  if (matchMedia('(max-width:700px)').matches) $('calculator-view').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  toast('기록을 불러왔어요. 숫자를 바꿔 다시 계산할 수 있습니다.');
}
function renderHistory() {
  $('history-count').textContent = String(history.length);
  $('export-history').disabled = !history.length;
  $('clear-history').disabled = !history.length;
  $('all-history').classList.toggle('active', state.filter === 'all');
  $('saved-history').classList.toggle('active', state.filter === 'saved');
  $('all-history').setAttribute('aria-pressed', String(state.filter === 'all'));
  $('saved-history').setAttribute('aria-pressed', String(state.filter === 'saved'));
  const search = $('history-search').value.trim().toLocaleLowerCase();
  const items = history.filter(item => (state.filter !== 'saved' || item.name) && (!search || `${item.expression} ${item.name} ${item.memo} ${item.value}`.toLocaleLowerCase().includes(search)));
  const list = $('history-list');
  list.replaceChildren();
  if (!items.length) {
    const empty = element('div', 'history-empty');
    const artwork = element('div', 'empty-art');
    artwork.append(icon(search ? 'search' : 'note'));
    empty.append(artwork, element('h3', '', search ? '찾는 계산이 없어요' : state.filter === 'saved' ? '기억할 계산을 남겨 보세요' : '첫 계산을 기다리고 있어요'));
    const desc = element('p', '', search ? '다른 이름이나 계산식으로 검색해 보세요.' : state.filter === 'saved' ? '계산 후 ‘이름 붙여 저장’을 눌러 보세요.' : '= 을 누르면 계산이 여기에 쌓여요.');
    empty.append(desc);
    list.append(empty);
    return;
  }
  for (const entry of items) {
    const article = element('article', 'history-item');
    const button = element('button', 'history-recall');
    button.setAttribute('aria-label', `${entry.name || entry.expression} 다시 계산`);
    if (entry.name) { const title = element('div', 'history-item-title'); title.append(icon('bookmark'), document.createTextNode(entry.name)); button.append(title); }
    button.append(element('div', 'history-item-expression', entry.expression));
    const formatted = displayResult(entry);
    button.append(element('div', 'history-item-result', `${formatted.approximate ? '≈' : '='} ${formatted.display}`));
    if (entry.memo) button.append(element('div', 'history-item-memo', entry.memo));
    button.addEventListener('click', () => recall(entry));
    const bottom = element('div', 'history-item-bottom');
    bottom.append(element('time', 'history-time', humanDate(entry.createdAt)));
    const actions = element('div', 'history-item-actions');
    actions.append(actionButton(entry.name ? '이름과 메모 수정' : '이름 붙여 저장', entry.name ? 'edit' : 'bookmark', () => openSave(entry)), actionButton('계산 내역 복사', 'copy', () => copyText(entryText(entry))), actionButton('이 계산 삭제', 'trash', () => removeEntry(entry.id)));
    bottom.append(actions);
    article.append(button, bottom);
    list.append(article);
  }
}
async function confirmDelete(title, message) {
  const dialog = $('confirm-dialog');
  if (dialog.open) return false;
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function removeEntry(id) {
  const entry = history.find(item => item.id === id);
  if (!entry) return;
  if (entry.name && !await confirmDelete('저장한 계산을 지울까요?', `‘${entry.name}’ 계산과 메모를 지웁니다.`)) return;
  const position = history.indexOf(entry);
  history = history.filter(item => item.id !== id);
  if (state.entryId === id) { state.entryId = null; state.committed = false; }
  persistHistory(); renderHistory();
  updatePreview();
  toast('계산을 지웠어요.', () => { if (!history.some(item => item.id === id)) history.splice(Math.min(position, history.length), 0, entry); trimHistory(); persistHistory(); renderHistory(); });
}
function openSave(entry) {
  if (!entry) entry = commit();
  if (!entry) return;
  editingId = entry.id;
  const formatted = displayResult(entry);
  $('save-preview').textContent = `${entry.expression} ${formatted.approximate ? '≈' : '='} ${formatted.display}`;
  $('calculation-name').value = entry.name;
  $('calculation-memo').value = entry.memo;
  $('save-dialog').showModal();
  $('calculation-name').focus();
}
function entryText(entry) { return [entry.name, `${entry.expression} ${entry.approximate ? '≈' : '='} ${entry.value}`, entry.memo].filter(Boolean).join('\n'); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('복사했어요.'); return true; }
  catch {
    const field = document.createElement('textarea');
    field.value = text; field.style.position = 'fixed'; field.style.top = '-1000px';
    document.body.append(field); field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* The browser may deny clipboard access. */ }
    field.remove();
    toast(ok ? '복사했어요.' : '복사가 제한된 브라우저입니다. 계산식을 선택해 직접 복사해 주세요.');
    return ok;
  }
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function switchView(view, focusTab = false) {
  state.view = view;
  $('calculator-view').hidden = view !== 'calc';
  $('notes-view').hidden = view !== 'notes';
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focusTab) button.focus();
  }
  document.title = view === 'notes' ? '계산노트 · calc' : 'calc · 계산과 기록을 한곳에';
}
function syncTheme() {
  const dark = document.body.dataset.theme === 'dark';
  const button = $('theme-button');
  button.replaceChildren(icon(dark ? 'sun' : 'moon'));
  button.setAttribute('aria-label', dark ? '밝은 테마로 변경' : '어두운 테마로 변경');
}

readSettings(); readHistory();
if (!document.body.dataset.theme) document.body.dataset.theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
syncTheme(); updateModes(); renderHistory();
mountNotes($('notes-container'), { toast, onStorageError: () => toast('계산노트 저장 상태를 확인해 주세요.') });
expression.maxLength = 2048;
expression.addEventListener('input', () => {
  const start = expression.selectionStart;
  expression.value = normalize(expression.value);
  expression.setSelectionRange(start, start);
  state.committed = false; state.entryId = null; state.carryApproximate = false; updatePreview();
});
expression.addEventListener('beforeinput', event => { if (state.committed && event.inputType.startsWith('insert')) { expression.value = ''; state.committed = false; state.carryApproximate = false; } });
expression.addEventListener('pointerdown', () => { state.committed = false; });
for (const button of document.querySelectorAll('[data-insert]')) {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => insert(button.dataset.insert));
}
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    if (button.dataset.action === 'clear') clear();
    if (button.dataset.action === 'equals') commit();
    if (button.dataset.action === 'sign') toggleSign();
    if (button.dataset.action === 'parenthesis') {
      const text = expression.value.slice(0, expression.selectionStart ?? expression.value.length);
      const balance = [...text].reduce((n, c) => n + (c === '(' ? 1 : c === ')' ? -1 : 0), 0);
      insert(balance > 0 && /[\d)πe!%]$/.test(text) ? ')' : '(');
    }
  });
}
$('backspace-button').addEventListener('pointerdown', event => event.preventDefault());
$('backspace-button').addEventListener('click', backspace);
$('basic-mode').addEventListener('click', () => { state.mode = 'basic'; updateModes(); });
$('scientific-mode').addEventListener('click', () => { state.mode = 'scientific'; updateModes(); });
$('angle-button').addEventListener('click', () => { state.angleMode = state.angleMode === 'DEG' ? 'RAD' : 'DEG'; state.committed = false; state.entryId = null; updateModes(); });
$('save-button').addEventListener('click', () => openSave());
$('save-form').addEventListener('submit', event => {
  event.preventDefault();
  const entry = history.find(item => item.id === editingId);
  const name = $('calculation-name').value.trim();
  if (!entry || !name) return;
  if (!entry.name && history.filter(item => item.name).length >= 1000) return toast('이름 붙인 계산은 1,000개까지 저장할 수 있어요. 내보낸 뒤 필요한 기록을 정리해 주세요.');
  entry.name = name.slice(0, 80); entry.memo = $('calculation-memo').value.trim().slice(0, 500);
  const saved = persistHistory();
  renderHistory(); updatePreview(); $('save-dialog').close();
  toast(saved ? '이름을 붙여 저장했어요.' : '이름과 메모는 이 창에서만 유지돼요. 내보내기로 보관해 주세요.');
});
$('copy-button').addEventListener('click', () => { if (state.result) copyText(state.result.value); });
$('share-button').addEventListener('click', async () => {
  if (!state.result) return;
  const text = `${expression.value} ${state.result.approximate ? '≈' : '='} ${state.result.value}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'calc 계산', text }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  await copyText(text);
});
$('history-search').addEventListener('input', renderHistory);
$('all-history').addEventListener('click', () => { state.filter = 'all'; renderHistory(); });
$('saved-history').addEventListener('click', () => { state.filter = 'saved'; renderHistory(); });
$('clear-history').addEventListener('click', async () => {
  if (!await confirmDelete('계산 기록을 모두 지울까요?', `이름을 붙인 계산을 포함해 ${history.length}개의 기록을 지웁니다.\n계산노트는 그대로 유지됩니다.`)) return;
  const previous = history.slice(); history = []; state.entryId = null; state.committed = false;
  persistHistory(); renderHistory(); updatePreview();
  toast('계산 기록을 모두 지웠어요.', () => { const ids = new Set(history.map(item => item.id)); history.push(...previous.filter(item => !ids.has(item.id))); trimHistory(); persistHistory(); renderHistory(); });
});
$('export-history').addEventListener('click', () => {
  if (!history.length) return;
  const content = history.map(entry => `${entryText(entry)}\n${new Date(entry.createdAt).toLocaleString('ko-KR')} · ${entry.angleMode}`).join('\n\n────────────\n\n');
  download(`calc-계산기록-${new Date().toLocaleDateString('sv-SE')}.txt`, `calc 계산 기록\n\n${content}\n`, 'text/plain;charset=utf-8');
  toast('계산 기록의 텍스트 파일 다운로드를 시작했어요.');
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => switchView(button.dataset.view));
document.querySelector('.workspace-nav').addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); switchView(event.key === 'Home' ? 'calc' : event.key === 'End' ? 'notes' : state.view === 'calc' ? 'notes' : 'calc', true); } });
$('open-notes').addEventListener('click', () => switchView('notes', true));
$('theme-button').addEventListener('click', () => { document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark'; syncTheme(); saveSettings(); });
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('privacy-button').addEventListener('click', () => $('privacy-dialog').showModal());
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog.app-dialog')) dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
document.addEventListener('keydown', event => {
  if (state.view !== 'calc' || document.querySelector('dialog[open]') || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && target !== expression && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  if (event.key === 'Enter' && target instanceof HTMLButtonElement) return;
  if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); commit(); }
  else if (event.key === 'Escape') { event.preventDefault(); clear(); }
  else if (event.key === 'Backspace' && !(target instanceof HTMLButtonElement)) { event.preventDefault(); backspace(); }
  else if (/^[\d.+\-*/%^()!]$/.test(event.key)) { event.preventDefault(); insert(event.key); }
  else if (/^[a-z]$/i.test(event.key) && target !== expression && !(target instanceof HTMLButtonElement)) { event.preventDefault(); insert(event.key); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSettings(); });
window.addEventListener('pagehide', saveSettings);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; $('install-button').hidden = false; });
$('install-button').addEventListener('click', async () => { if (!deferredInstall) return; await deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('install-button').hidden = true; });
window.addEventListener('appinstalled', () => { $('install-button').hidden = true; toast('홈 화면에서 calc를 열 수 있어요.'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let reloadForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadForUpdate) { reloadForUpdate = false; location.reload(); } });
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const announce = () => {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      $('update-banner').hidden = false;
      $('update-button').onclick = () => {
        saveSettings();
        const waiting = registration.waiting;
        if (!waiting) { location.reload(); return; }
        reloadForUpdate = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
      };
    };
    announce();
    registration.addEventListener('updatefound', () => { const installing = registration.installing; installing?.addEventListener('statechange', () => { if (installing.state === 'installed') announce(); }); });
  }).catch(() => { /* Online calculation is available if offline installation is unavailable. */ });
}
