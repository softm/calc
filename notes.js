import { evaluateExpression, formatNumber } from './engine.js';

const STORAGE_KEY = 'calc.notes.v1';
const MAX_NOTES = 100;
const MAX_ROWS = 100;
const uid = () => globalThis.crypto?.randomUUID?.() || `n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const blankRow = () => ({ id: uid(), label: '', quantity: '', unitPrice: '' });
const nameOf = note => note.title.trim() || '이름 없는 메모';
const numberText = value => formatNumber(value, { maxFractionDigits: 48 });
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, className = '', action) => {
  const node = element('button', `notes-btn ${className}`, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
};
const decimal = value => {
  const text = value.trim();
  if (!text) return '0';
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  return text.startsWith('.') ? `0${text}` : text.endsWith('.') ? `${text}0` : text;
};
function calculate(note) {
  let total = '0';
  let valid = true;
  const rows = note.rows.map(row => {
    const quantity = decimal(row.quantity);
    const unitPrice = decimal(row.unitPrice);
    const errors = [];
    if (quantity === null) errors.push('quantity');
    if (unitPrice === null) errors.push('unitPrice');
    let value = '0';
    if (!errors.length) {
      try {
        value = evaluateExpression(`(${quantity})*(${unitPrice})`).value;
        total = evaluateExpression(`(${total})+(${value})`).value;
      } catch {
        errors.push('quantity', 'unitPrice');
      }
    }
    if (errors.length) valid = false;
    return { ...row, quantity, unitPrice, value, errors };
  });
  return { rows, total, valid };
}
function validateState(value) {
  const string = (item, max) => typeof item === 'string' && item.length <= max;
  const id = item => string(item, 80) && /^[a-zA-Z0-9_-]+$/.test(item);
  const date = item => string(item, 32) && Number.isFinite(Date.parse(item));
  if (!value || value.version !== 1 || !Array.isArray(value.notes) || value.notes.length > MAX_NOTES) return false;
  const noteIds = new Set();
  for (const note of value.notes) {
    if (!note || !id(note.id) || noteIds.has(note.id) || !string(note.title, 100) || !date(note.createdAt) || !date(note.updatedAt)) return false;
    if (!Array.isArray(note.rows) || !note.rows.length || note.rows.length > MAX_ROWS) return false;
    noteIds.add(note.id);
    const rowIds = new Set();
    for (const row of note.rows) {
      if (!row || !id(row.id) || rowIds.has(row.id) || !string(row.label, 120) || !string(row.quantity, 24) || !string(row.unitPrice, 24)) return false;
      rowIds.add(row.id);
    }
  }
  return value.selectedId === null || (id(value.selectedId) && noteIds.has(value.selectedId));
}

export function mountNotes(container, { toast = () => {}, onStorageError = () => {} } = {}) {
  let state = { version: 1, selectedId: null, notes: [] };
  let saveTimer;
  let readable = true;
  let storageFailed = false;
  let deletingId = null;
  let previousFocus;
  const warning = element('p', 'notes-storage-warning');
  warning.setAttribute('role', 'status');
  warning.hidden = true;
  const layout = element('div', 'notes-layout');
  const sidebar = element('aside', 'notes-sidebar');
  sidebar.setAttribute('aria-label', '저장된 계산 메모');
  const editor = element('section', 'notes-editor');
  editor.setAttribute('aria-label', '계산 메모 편집');
  const dialog = element('dialog', 'notes-dialog');
  const dialogTitle = element('h3', '', '이 메모를 삭제할까요?');
  const dialogMessage = element('p');
  const dialogActions = element('div', 'notes-dialog-actions');
  const cancelDelete = button('취소', '', () => dialog.close());
  const confirmDelete = button('삭제하기', 'notes-btn-danger', () => {
    state.notes = state.notes.filter(note => note.id !== deletingId);
    if (state.selectedId === deletingId) state.selectedId = state.notes[0]?.id || null;
    deletingId = null;
    saveNow();
    render();
    dialog.close();
    toast('메모를 삭제했습니다.');
  });
  dialog.setAttribute('aria-label', '계산 메모 삭제 확인');
  dialogActions.append(cancelDelete, confirmDelete);
  dialog.append(dialogTitle, dialogMessage, dialogActions);
  dialog.addEventListener('close', () => {
    deletingId = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    else sidebar.querySelector('button')?.focus();
  });
  layout.append(sidebar, editor);
  container.replaceChildren(warning, layout, dialog);

  function storageError(error, corrupt = false) {
    if (corrupt) readable = false;
    warning.textContent = corrupt
      ? '저장된 메모를 읽을 수 없습니다. 원래 데이터는 보존됩니다. 현재 작업은 복사하거나 CSV로 저장해 주세요.'
      : '기기에 저장하지 못했습니다. 이 화면의 작업은 유지됩니다. 내용을 복사하거나 CSV로 저장해 주세요.';
    warning.hidden = false;
    if (!storageFailed) onStorageError(error);
    storageFailed = true;
    updateSavedLabel();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const stored = JSON.parse(raw);
      if (!validateState(stored)) throw new Error('Invalid calculation-notes data');
      state = stored;
      if (!state.selectedId) state.selectedId = state.notes[0]?.id || null;
    }
  } catch (error) { storageError(error, true); }

  const current = () => state.notes.find(note => note.id === state.selectedId);
  function updateSavedLabel() {
    const label = editor.querySelector('.notes-saved');
    if (label) label.textContent = storageFailed ? '저장하지 못함' : saveTimer ? '저장 중…' : '이 기기에 자동 저장';
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!readable) return updateSavedLabel();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageFailed = false;
      warning.hidden = true;
    } catch (error) { storageError(error); }
    updateSavedLabel();
  }
  function changed() {
    const note = current();
    if (note) note.updatedAt = new Date().toISOString();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
    updateSavedLabel();
    updateSummary();
  }
  function addNote(source) {
    if (state.notes.length >= MAX_NOTES) return toast('메모는 최대 100개까지 저장할 수 있습니다.');
    const now = new Date().toISOString();
    const note = { id: uid(), title: source ? `${nameOf(source)} 복사`.slice(0, 100) : '',
      rows: source ? source.rows.map(row => ({ ...row, id: uid() })) : [blankRow()], createdAt: now, updatedAt: now };
    state.notes.unshift(note);
    state.selectedId = note.id;
    saveNow();
    render();
    editor.querySelector('.notes-title-input')?.focus();
    if (source) toast('메모를 복제했습니다.');
  }
  function renderSidebar() {
    const heading = element('div', 'notes-sidebar-heading');
    heading.append(element('h2', '', '내 계산 메모'), element('span', 'notes-count', String(state.notes.length)));
    const add = button('＋ 새 메모', 'notes-btn-primary notes-new', () => addNote());
    const list = element('div', 'notes-list');
    for (const note of state.notes) {
      const entry = button('', 'notes-entry', () => {
        saveNow();
        state.selectedId = note.id;
        saveNow();
        render();
      });
      entry.dataset.noteId = note.id;
      if (note.id === state.selectedId) entry.setAttribute('aria-current', 'true');
      entry.append(element('strong', 'notes-name', nameOf(note)), element('span', 'notes-date'), element('span', 'notes-preview'));
      fillSummary(entry, note);
      list.append(entry);
    }
    if (!state.notes.length) list.append(element('p', 'notes-sidebar-empty', '계산을 작업별로\n모아 보관하세요.'));
    const localHint = element('p', 'notes-local-hint', '메모는 이 브라우저에 저장돼요. 중요한 계산은 CSV로 보관하세요.');
    sidebar.replaceChildren(heading, add, list, localHint);
  }
  function fillSummary(entry, note) {
    const result = calculate(note);
    entry.querySelector('.notes-name').textContent = nameOf(note);
    entry.querySelector('.notes-date').textContent = `${note.rows.length}개 항목 · ${new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(note.updatedAt))}`;
    entry.querySelector('.notes-preview').textContent = result.valid ? `${numberText(result.total)}원` : '입력 확인 필요';
  }
  function updateSummary() {
    const note = current();
    if (!note) return;
    const entry = sidebar.querySelector(`[data-note-id="${note.id}"]`);
    if (entry) fillSummary(entry, note);
  }
  function render() {
    renderSidebar();
    const note = current();
    if (!note) {
      const empty = element('div', 'notes-empty');
      const symbol = element('span', 'notes-empty-symbol', '≡');
      symbol.setAttribute('aria-hidden', 'true');
      empty.append(symbol, element('h2', '', '계산에 이름을 붙여 보세요'),
        element('p', '', '항목과 수량, 단가를 적으면 합계가 바로 나와요.\n필요할 때 다시 수정하고 함께 공유하세요.'),
        button('첫 메모 만들기', 'notes-btn-primary', () => addNote()));
      editor.replaceChildren(empty);
      return;
    }
    const header = element('div', 'notes-editor-header');
    const titleLabel = element('label', 'notes-title-label');
    titleLabel.append(element('span', '', '메모 이름'));
    const title = element('input', 'notes-title-input');
    title.type = 'text'; title.maxLength = 100; title.placeholder = '메모 이름을 입력하세요'; title.value = note.title;
    title.addEventListener('input', () => { note.title = title.value; changed(); });
    titleLabel.append(title);
    const saved = element('span', 'notes-saved');
    header.append(titleLabel, saved);
    const toolbar = element('div', 'notes-toolbar');
    toolbar.append(button('내용 복사', '', () => exportNote('copy')), button('공유', '', () => exportNote('share')),
      button('CSV 저장', '', () => exportNote('csv')), button('복제', '', () => addNote(note)),
      button('메모 삭제', 'notes-delete-note', () => {
        previousFocus = document.activeElement; deletingId = note.id;
        dialogMessage.textContent = `“${nameOf(note)}” 메모와 모든 항목이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`;
        dialog.showModal(); cancelDelete.focus();
      }));
    const table = element('div', 'notes-table');
    const tableHeading = element('div', 'notes-table-heading');
    tableHeading.setAttribute('aria-hidden', 'true');
    ['항목', '수량', '단가 (원)', '금액 (원)', ''].forEach(text => tableHeading.append(element('span', '', text)));
    table.append(tableHeading);
    note.rows.forEach((row, index) => {
      const line = element('div', 'notes-row');
      line.dataset.rowId = row.id;
      for (const [field, text] of [['label', '항목'], ['quantity', '수량'], ['unitPrice', '단가 (원)']]) {
        const label = element('label', `notes-field notes-field-${field === 'label' ? 'description' : field}`);
        const input = element('input', 'notes-input');
        input.type = 'text'; input.name = field; input.value = row[field];
        input.maxLength = field === 'label' ? 120 : 24;
        input.placeholder = field === 'label' ? '항목 이름' : '0';
        input.setAttribute('aria-label', `${index + 1}번째 항목 ${text}`);
        if (field !== 'label') input.inputMode = 'decimal';
        input.addEventListener('input', () => { row[field] = input.value; updateAmounts(); changed(); });
        label.append(element('span', 'notes-field-label', text), input);
        line.append(label);
      }
      const amount = element('div', 'notes-row-amount');
      amount.append(element('span', 'notes-field-label', '금액 (원)'), element('output', 'notes-amount'));
      const remove = button('×', 'notes-remove-row', () => {
        note.rows = note.rows.filter(item => item.id !== row.id);
        if (!note.rows.length) note.rows.push(blankRow());
        changed(); render();
        editor.querySelectorAll('.notes-field-description input')[Math.min(index, note.rows.length - 1)]?.focus();
      });
      remove.setAttribute('aria-label', `${index + 1}번째 항목 삭제`); remove.title = '항목 삭제';
      const error = element('p', 'notes-row-error');
      error.hidden = true;
      line.append(amount, remove, error);
      table.append(line);
    });
    const addRow = button('＋ 항목 추가', 'notes-add-row', () => {
      if (note.rows.length >= MAX_ROWS) return toast('한 메모에는 최대 100개 항목을 추가할 수 있습니다.');
      note.rows.push(blankRow()); changed(); render();
      editor.querySelector('.notes-row:last-child input')?.focus();
    });
    const total = element('div', 'notes-total');
    const totalLabel = element('div');
    totalLabel.append(element('span', 'notes-total-label', '합계'), element('span', 'notes-total-hint', '수량 × 단가의 합계'));
    const totalValue = element('output', 'notes-total-value');
    totalValue.setAttribute('aria-label', '계산 메모 합계');
    total.append(totalLabel, totalValue);
    const help = element('p', 'notes-help', '빈 수량·단가는 0으로 계산해요. 소수는 마침표(.)로 입력하세요. 세금은 자동으로 더하지 않아요.');
    editor.replaceChildren(header, toolbar, table, addRow, total, help);
    updateAmounts(); updateSavedLabel();
  }
  function updateAmounts() {
    const note = current();
    if (!note) return;
    const result = calculate(note);
    result.rows.forEach(row => {
      const line = editor.querySelector(`[data-row-id="${row.id}"]`);
      if (!line) return;
      const output = line.querySelector('.notes-amount');
      output.textContent = row.errors.length ? '—' : numberText(row.value);
      output.title = row.errors.length ? '입력을 확인하세요' : `${row.value}원`;
      for (const field of ['quantity', 'unitPrice']) line.querySelector(`[name="${field}"]`).setAttribute('aria-invalid', String(row.errors.includes(field)));
      const error = line.querySelector('.notes-row-error');
      error.hidden = !row.errors.length;
      error.textContent = '수량과 단가에 0 이상의 숫자를 입력해 주세요.';
    });
    const total = editor.querySelector('.notes-total-value');
    if (total) { total.textContent = result.valid ? `${numberText(result.total)}원` : '입력 확인 필요'; total.title = result.valid ? `${result.total}원` : ''; }
  }
  async function copyText(text, message = '계산 내역을 복사했습니다.') {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const focus = document.activeElement;
      const textarea = element('textarea', 'notes-copy-buffer'); textarea.value = text;
      container.append(textarea); textarea.select();
      const copied = document.execCommand('copy'); textarea.remove(); focus?.focus();
      if (!copied) throw new Error('Copy unavailable');
    }
    toast(message);
  }
  async function exportNote(kind) {
    const note = current();
    if (!note) return;
    const result = calculate(note);
    if (!result.valid) return toast('수량과 단가의 입력 오류를 먼저 수정해 주세요.');
    const rows = result.rows.filter((row, index) => note.rows[index].label.trim() || note.rows[index].quantity.trim() || note.rows[index].unitPrice.trim());
    const text = `${nameOf(note)}\n\n${rows.map((row, i) => `${row.label.trim() || `항목 ${i + 1}`}: ${numberText(row.quantity)} × ${numberText(row.unitPrice)} = ${numberText(row.value)}원`).join('\n')}\n\n합계: ${numberText(result.total)}원`;
    try {
      if (kind === 'csv') {
        const safe = value => /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
        const records = [[safe(nameOf(note)), '', '', ''], ['항목', '수량', '단가(원)', '금액(원)'],
          ...rows.map((row, i) => [safe(row.label.trim() || `항목 ${i + 1}`), row.quantity, row.unitPrice, row.value]), ['합계', '', '', result.total]];
        const csv = '\ufeff' + records.map(record => record.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = element('a'); link.href = url;
        link.download = `${nameOf(note).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || '계산-메모'}.csv`;
        container.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('CSV 다운로드를 시작했습니다.');
      } else if (kind === 'share' && navigator.share) {
        try { await navigator.share({ title: nameOf(note), text }); }
        catch (error) { if (error.name !== 'AbortError') await copyText(text, '공유할 수 없어 내용을 복사했습니다.'); }
      } else await copyText(text, kind === 'share' ? '공유할 내용을 복사했습니다.' : undefined);
    } catch { toast('내보내지 못했습니다. 다른 내보내기 방법을 선택해 주세요.'); }
  }
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
  render();
  return { refresh: render, focus: () => (editor.querySelector('input') || sidebar.querySelector('button'))?.focus() };
}
