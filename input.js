/** Pure editing operations for the calculator's expression field. */
const NUMBER = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+−-]?\\d+)?';
const MAX_LENGTH = 2048;
const normalize = value => value.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−');

function edit(value, caret, carryApproximate = false) {
  if (value.length > MAX_LENGTH) throw new Error('계산식은 2,048자까지 입력할 수 있어요.');
  return { value, start: caret, end: caret, carryApproximate: value.trim() ? carryApproximate : false };
}

function numericWrapper(value, caret) {
  const pattern = new RegExp(`\\(([+−-]?(?:${NUMBER})?)\\)`, 'g');
  for (const match of value.matchAll(pattern)) {
    const open = match.index;
    const close = open + match[0].length - 1;
    if (caret < open + 1 || caret > close + 1) continue;
    // A function's argument parentheses belong to the function, not a number.
    if (/(?:sqrt|abs|sin|cos|tan|log|ln)\s*$/i.test(value.slice(0, open))) continue;
    return { open, close, body: match[1] };
  }
  return null;
}

function unaryMinusBefore(value, start) {
  let sign = start - 1;
  while (sign >= 0 && /\s/.test(value[sign])) sign--;
  if (!['-', '−'].includes(value[sign])) return null;
  let before = sign - 1;
  while (before >= 0 && /\s/.test(value[before])) before--;
  return before < 0 || /[+−\-×÷*/^(]/.test(value[before]) ? sign : null;
}

function replace(value, start, end, text, caretOffset, carryApproximate) {
  return edit(value.slice(0, start) + text + value.slice(end), start + caretOffset, carryApproximate);
}

function wholeAtom(text) {
  if (new RegExp(`^(?:${NUMBER}|π|pi|e)$`, 'i').test(text)) return true;
  const group = text.replace(/^(?:sqrt|abs|sin|cos|tan|log|ln)\s*/i, '');
  if (!group.startsWith('(') || !group.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < group.length; i++) {
    if (group[i] === '(') depth++;
    if (group[i] === ')') depth--;
    if (depth === 0 && i !== group.length - 1) return false;
  }
  return depth === 0;
}

export function insertCalculatorText({ value, start, end, committed = false, result = null,
  carryApproximate = false }, text) {
  text = normalize(text);
  if (committed) {
    const continuation = /^[+−×÷^%!]/.test(text) && result;
    // A result is one operand: a negative result squared must be (-3)^2.
    value = continuation ? `(${normalize(result.value)})` : '';
    start = end = value.length;
    carryApproximate = Boolean(continuation && result.approximate);
  } else if (start === end) {
    if (text === ')' && value[start] === ')') return edit(value, start + 1, carryApproximate);
    const wrapper = numericWrapper(value, start);
    // Digits keep editing the signed number; operators act on that whole number.
    if (wrapper && start === wrapper.close && /\d/.test(wrapper.body) && /^[+−×÷^%!]/.test(text)) {
      start = end = wrapper.close + 1;
    }
  }
  if (start === 0 && end === value.length && !committed) carryApproximate = false;
  return replace(value, start, end, text, text.length, carryApproximate);
}

export function toggleCalculatorSign({ value, start, end, committed = false, result = null,
  carryApproximate = false }) {
  if (committed && result) {
    const number = normalize(result.value);
    const changed = number.startsWith('−') ? number.slice(1) : `(−${number})`;
    return edit(changed, changed.endsWith(')') ? changed.length - 1 : changed.length, result.approximate);
  }
  if (start !== end) {
    const selected = value.slice(start, end);
    if (new RegExp(`^[+−-]?${NUMBER}$`).test(selected)) {
      const body = /^[−-]/.test(selected) ? selected.slice(1) : `−${selected.replace(/^\+/, '')}`;
      return replace(value, start, end, `(${body})`, body.length + 1, carryApproximate);
    }
    const changed = `(−(${selected}))`;
    return replace(value, start, end, changed, changed.length, carryApproximate);
  }
  const wrapper = numericWrapper(value, start);
  if (wrapper) {
    if (/^[+−-]?$/.test(wrapper.body)) {
      return replace(value, wrapper.open, wrapper.close + 1, '', 0, carryApproximate);
    }
    const body = /^[−-]/.test(wrapper.body) ? wrapper.body.slice(1) : `−${wrapper.body.replace(/^\+/, '')}`;
    const changed = `(${body})`;
    return replace(value, wrapper.open, wrapper.close + 1, changed, changed.length - 1, carryApproximate);
  }
  for (const match of value.matchAll(new RegExp(NUMBER, 'g'))) {
    const numberStart = match.index;
    const numberEnd = numberStart + match[0].length;
    if (start < numberStart || start > numberEnd) continue;
    const sign = unaryMinusBefore(value, numberStart);
    if (sign !== null) return replace(value, sign, numberEnd, match[0], match[0].length, carryApproximate);
    const changed = `(−${match[0]})`;
    return replace(value, numberStart, numberEnd, changed, changed.length - 1, carryApproximate);
  }
  const prefix = value.slice(0, start);
  if (!prefix.trim() || /[+−\-×÷*/^(]\s*$/.test(prefix)) {
    const sign = unaryMinusBefore(value, start);
    if (sign !== null) return replace(value, sign, start, '', 0, carryApproximate);
    return replace(value, start, end, '(−)', 2, carryApproximate);
  }
  let operandStart = null;
  if (prefix.endsWith(')')) {
    let depth = 0;
    for (let position = start - 1; position >= 0; position--) {
      if (value[position] === ')') depth++;
      if (value[position] === '(' && --depth === 0) { operandStart = position; break; }
    }
    if (operandStart !== null) {
      const fn = value.slice(0, operandStart).match(/(?:sqrt|abs|sin|cos|tan|log|ln)\s*$/i);
      if (fn) operandStart = fn.index;
    }
  } else {
    const constant = prefix.match(/(?:π|pi|e)$/i);
    if (constant) operandStart = constant.index;
  }
  if (operandStart !== null) {
    const sign = unaryMinusBefore(value, operandStart);
    if (sign !== null) return replace(value, sign, start, value.slice(operandStart, start), start - operandStart, carryApproximate);
    const operand = value.slice(operandStart, start);
    const negativeBody = /^\([−-]/.test(operand) && operand.endsWith(')') ? operand.slice(2, -1) : null;
    const changed = negativeBody && wholeAtom(negativeBody) ? `(${negativeBody})` : `(−${operand})`;
    return replace(value, operandStart, start, changed, changed.length, carryApproximate);
  }
  throw new Error('부호를 바꿀 숫자나 괄호를 선택해 주세요.');
}
