import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalculatorExpression, createMarkupExpression, addRegister } from '../office.js';
import { evaluateExpression } from '../engine.js';

function calc(text, mode = 'office') {
  return evaluateCalculatorExpression(text, { mode }).value;
}

test('사무용 %는 앞의 금액을 기준으로 가산·차감한다', () => {
  assert.equal(calc('200 + 10%'), '220');
  assert.equal(calc('200 − 10%'), '180');
  assert.equal(calc('200 × 10%'), '20');
  assert.equal(calc('200 + 10% − 10%'), '198');
  assert.equal(calc('200 + 10% + 10%'), '242');
});

test('기본·공학 모드는 기존 퍼센트 계산을 유지한다', () => {
  assert.equal(calc('200 + 10%', 'basic'), '200.1');
  assert.equal(calc('200 + 10%', 'scientific'), '200.1');
  assert.equal(calc('0.1 + 0.2', 'office'), '0.3');
  assert.equal(calc('1e+2%'), '1');
  assert.equal(calc('200 + 1e+2%'), '400');
  assert.equal(calc('200 + 1e-2%'), '200.02');
});

test('MU는 원가 대비 목표 매출이익률을 적용하고 오류를 구분한다', () => {
  const markup = createMarkupExpression('100 ÷ 20');
  assert.equal(evaluateExpression(markup.expression).value, '125');
  assert.equal(evaluateExpression(createMarkupExpression('240 ÷ 25%').expression).value, '320');
  assert.throws(() => createMarkupExpression('100 ÷ 100'), /100% 미만/);
  assert.throws(() => createMarkupExpression('100 + 10'), /원가/);
});

test('M+/M− 및 GT 누적은 소수 오차 없이 계산한다', () => {
  const m = addRegister('0.1', '0.2');
  assert.equal(m.value, '0.3');
  assert.equal(addRegister(m.value, '0.1', { subtract: true }).value, '0.2');
});
