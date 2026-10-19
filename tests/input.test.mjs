import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../engine.js';
import { insertCalculatorText, toggleCalculatorSign } from '../input.js';

const initial = (value = '', options = {}) => ({ value, start: value.length, end: value.length,
  committed: false, result: null, carryApproximate: false, ...options });
const calculate = edit => evaluateExpression(edit.value).value;
const committed = value => initial(value, { committed: true, result: evaluateExpression(value) });

test('a committed negative result stays one operand for powers and factorial', () => {
  assert.equal(calculate(insertCalculatorText(committed('2−5'), '^2')), '9');
  assert.equal(calculate(insertCalculatorText(committed('2−5'), '^3')), '-27');
  assert.throws(() => calculate(insertCalculatorText(committed('0−3'), '!')), /정수/);
  assert.equal(calculate(insertCalculatorText(committed('2−5'), '%')), '-0.03');
});

test('pressing sign twice restores the value of the selected operand', () => {
  for (const value of ['2+3', '2−3', '5×3', '12', '-12']) {
    const once = toggleCalculatorSign(initial(value));
    const twice = toggleCalculatorSign(once);
    assert.equal(calculate(twice), evaluateExpression(value).value, value);
  }
  assert.equal(calculate(toggleCalculatorSign(initial('2+3'))), '-1');
});

test('digits after sign continue the same number rather than implicitly multiplying', () => {
  let edit = toggleCalculatorSign(initial('1'));
  edit = insertCalculatorText(edit, '2');
  assert.equal(calculate(edit), '-12');
  edit = insertCalculatorText(edit, '.');
  edit = insertCalculatorText(edit, '5');
  assert.equal(calculate(edit), '-12.5');
});

test('operators after sign apply to the signed operand', () => {
  const negative = toggleCalculatorSign(initial('3'));
  assert.equal(calculate(insertCalculatorText(negative, '^2')), '9');
  assert.throws(() => calculate(insertCalculatorText(negative, '!')), /정수/);
  const plus = insertCalculatorText(negative, '+');
  assert.equal(calculate(insertCalculatorText(plus, '4')), '1');
});

test('sign before entering a number works initially and after binary operators', () => {
  for (const [prefix, expected] of [['', '-3'], ['5×', '-15'], ['5+', '2'], ['5−', '8']]) {
    const signed = toggleCalculatorSign(initial(prefix));
    assert.equal(calculate(insertCalculatorText(signed, '3')), expected, prefix);
    assert.equal(toggleCalculatorSign(signed).value, prefix);
  }
});

test('sign respects the caret rather than always changing the last number', () => {
  const edited = toggleCalculatorSign(initial('12+34', { start: 2, end: 2 }));
  assert.equal(calculate(edited), '22');
  assert.equal(calculate(insertCalculatorText(edited, '5')), '-91');
  const selection = toggleCalculatorSign(initial('12+34', { start: 0, end: 2 }));
  assert.equal(calculate(selection), '22');
  assert.equal(calculate(insertCalculatorText(selection, '5')), '-91');
});

test('negated parenthesized expressions and functions remain atomic', () => {
  for (const value of ['(2+3)', 'cos(0)', '2+(3+4)']) {
    const signed = toggleCalculatorSign(initial(value));
    assert.equal(calculate(toggleCalculatorSign(signed)), evaluateExpression(value).value, value);
  }
  assert.equal(calculate(insertCalculatorText(toggleCalculatorSign(initial('(2+3)')), '^2')), '25');
  assert.equal(calculate(insertCalculatorText(toggleCalculatorSign(initial('cos(0)')), '^2')), '1');
});

test('committed result sign and following digits and powers stay consistent', () => {
  const negative = toggleCalculatorSign(committed('2+3'));
  assert.equal(calculate(negative), '-5');
  assert.equal(calculate(insertCalculatorText(negative, '2')), '-52');
  assert.equal(calculate(insertCalculatorText(negative, '^2')), '25');
  assert.equal(calculate(toggleCalculatorSign(negative)), '5');
});

test('function arguments remain editable and a signed argument is atomic', () => {
  const edit = toggleCalculatorSign(initial('sqrt(9)', { start: 6, end: 6 }));
  assert.equal(calculate(insertCalculatorText(edit, '^2')), '9');
});

test('continuation carries approximation while new calculation clears it', () => {
  const fraction = committed('1/3');
  assert.equal(insertCalculatorText(fraction, '+').carryApproximate, true);
  assert.equal(insertCalculatorText(fraction, '2').carryApproximate, false);
  assert.equal(insertCalculatorText(initial('123', { start: 0, end: 3, carryApproximate: true }), '7').carryApproximate, false);
});

test('closing a signed number overtypes its existing parenthesis', () => {
  const signed = toggleCalculatorSign(initial('3'));
  const closed = insertCalculatorText(signed, ')');
  assert.equal(closed.value, signed.value);
  assert.equal(closed.start, signed.value.length);
});
