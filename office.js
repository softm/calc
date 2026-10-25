import { evaluateExpression } from './engine.js';

/**
 * Office mode treats a trailing +/− percentage as a percentage of the amount
 * accumulated to its left. Other modes retain the exact engine's postfix %.
 * Nothing is evaluated with eval() or binary floating-point arithmetic.
 */
export function evaluateCalculatorExpression(expression, { mode = 'basic', angleMode = 'DEG' } = {}) {
  if (mode !== 'office') return evaluateExpression(expression, { angleMode });
  if (typeof expression !== 'string' || expression.length > 2048) {
    throw new Error('계산식이 너무 깁니다.');
  }
  const trimmed = expression.trim();
  // A numeric exponent such as 1e+2% is a single percentage, not addition.
  if (/^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+−-]?\d+)%$/u.test(trimmed)) {
    return evaluateExpression(trimmed, { angleMode });
  }
  const match = trimmed.match(/^(.+?)\s*([+−-])\s*((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+−-]?\d+)?)\s*%$/u);
  if (!match) return evaluateExpression(expression, { angleMode });
  const base = evaluateCalculatorExpression(match[1].trim(), { mode: 'office', angleMode });
  const percentValue = evaluateExpression(`(${base.value})×(${match[3]}%)`, { angleMode });
  const result = evaluateExpression(`(${base.value})${match[2] === '+' ? '+' : '−'}(${percentValue.value})`, { angleMode });
  result.approximate = result.approximate || base.approximate || percentValue.approximate;
  return result;
}

/** MU: COST ÷ MARGIN, for example 100 ÷ 20 → 125 (20% gross margin). */
export function createMarkupExpression(text, angleMode = 'DEG') {
  const match = String(text).trim().match(/^(.+)\s*[÷/]\s*((?:\d+(?:\.\d*)?|\.\d+))\s*%?\s*$/u);
  if (!match) throw new Error('MU: 원가 ÷ 목표 이익률을 입력하세요. 예: 100 ÷ 20');
  const amount = evaluateCalculatorExpression(match[1].trim(), { mode: 'office', angleMode });
  const margin = Number(match[2]);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) {
    throw new Error('목표 이익률은 0% 이상 100% 미만이어야 합니다.');
  }
  const output = `(${amount.value})÷(1−${match[2]}%)`;
  const checked = evaluateExpression(output, { angleMode });
  return { expression: output, approximate: checked.approximate || amount.approximate };
}

export function addRegister(current, next, { subtract = false, approximate = false } = {}) {
  const result = evaluateExpression(`(${current})${subtract ? '−' : '+'}(${next})`);
  result.approximate = result.approximate || approximate;
  return result;
}
