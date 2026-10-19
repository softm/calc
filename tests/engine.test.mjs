import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, formatNumber } from '../engine.js';

const exact = (expression, expected) => {
  assert.deepEqual(evaluateExpression(expression), { value: expected, approximate: false }, expression);
};
const close = (expression, expected, options) => {
  const result = evaluateExpression(expression, options);
  assert.equal(result.approximate, true, expression);
  assert.ok(Math.abs(Number(result.value) - expected) <= Math.max(1, Math.abs(expected)) * 1e-14,
    `${expression}: ${result.value} != ${expected}`);
};

test('decimal arithmetic never goes through binary floating point', () => {
  exact('0.1 + 0.2', '0.3');
  exact('1.005 * 100', '100.5');
  exact('9007199254740993 + 1', '9007199254740994');
  exact('218000 + 40000', '258000');
  exact('1.2 / 0.3', '4');
  exact('1 / 8', '0.125');
  exact('1 / 40', '0.025');
  exact('2.5000 - 2.5', '0');
});

test('fractions remain exact during intermediate calculations and round only at output', () => {
  assert.deepEqual(evaluateExpression('1 / 3'), { value: '0.3333333333333333', approximate: true });
  assert.deepEqual(evaluateExpression('2 / 3'), { value: '0.6666666666666667', approximate: true });
  assert.deepEqual(evaluateExpression('-2 / 3'), { value: '-0.6666666666666667', approximate: true });
  exact('(1 / 3) * 3', '1');
  exact('1 / 3 + 2 / 3', '1');
  exact('(22 / 7) * 7', '22');
});

test('operator precedence, right associative powers, and signed powers are explicit', () => {
  exact('2 + 3 * 4', '14');
  exact('(2 + 3) * 4', '20');
  exact('2^3^2', '512');
  exact('-2^2', '-4');
  exact('(-2)^2', '4');
  exact('2^-3', '0.125');
  exact('2^+3', '8');
  exact('-2^-2', '-0.25');
  exact('4--2', '6');
  exact('3!^2', '36');
  exact('2^3!', '64');
  exact('-3!', '-6');
});

test('Unicode operators, scientific notation, and implicit multiplication', () => {
  exact('8 × 3 ÷ 2 − 1', '11');
  exact('2(3+4)', '14');
  exact('(2+3)(4+5)', '45');
  exact('(2+3)4', '20');
  exact('6/2(1+2)', '9');
  exact('2sqrt(9)', '6');
  exact('√(81)', '9');
  exact('1e-3 + 2E-3', '0.003');
  exact('1.25e+2', '125');
  exact('.5 + 2.', '2.5');
  close('2π', Math.PI * 2);
  close('2pi', Math.PI * 2);
  close('2e', Math.E * 2);
});

test('postfix percent is consistently mathematical division by 100', () => {
  exact('10%', '0.1');
  exact('200+10%', '200.1');
  exact('200*10%', '20');
  exact('200*(1+10%)', '220');
  exact('(50+50)%', '1');
  exact('10%%', '0.001');
  exact('-10%', '-0.1');
});

test('exact square roots, absolute value, factorials, and scientific functions', () => {
  exact('sqrt(0)', '0');
  exact('sqrt(144)', '12');
  exact('sqrt(0.04)', '0.2');
  exact('sqrt(1/16)', '0.25');
  exact('sqrt(1e-1000)', '1e-500');
  exact('abs(-25.50)', '25.5');
  exact('0!', '1');
  exact('5!', '120');
  exact('10!', '3628800');
  close('sqrt(2)', Math.SQRT2);
  close('9^0.5', 3);
  close('log(1000)', 3);
  close('ln(e)', 1);
  assert.equal(evaluateExpression('170!').approximate, false);
  assert.match(evaluateExpression('170!').value, /^7\.257415615307/);
  const largeFactorial = evaluateExpression('170!').value;
  exact(`${largeFactorial}/${largeFactorial}`, '1');
});

test('angle modes and exact quadrants have predictable output', () => {
  close('sin(30)', 0.5);
  close('cos(60)', 0.5);
  close('tan(45)', 1);
  close('sin(90)', 1);
  close('cos(90)', 0);
  close('sin(-90)', -1);
  close('sin(360)', 0);
  close('tan(180)', 0);
  close('sin(pi/2)', 1, { angleMode: 'RAD' });
  close('cos(pi)', -1, { angleMode: 'RAD' });
  close('sin(10^1000)', Math.sin(280 * Math.PI / 180));
  assert.notEqual(evaluateExpression('sin(0.00000000000001)').value, '0');
});

test('real-number domain errors are descriptive Korean errors', () => {
  const errors = [
    ['1/0', /0으로/], ['0^-1', /0으로/], ['0^0', /정의/],
    ['sqrt(-1)', /음수/], ['log(0)', /0보다/], ['ln(-1)', /0보다/],
    ['(-2)^0.5', /거듭제곱/], ['(-3)!', /정수/], ['1.5!', /정수/],
    ['171!', /170/], ['tan(90)', /탄젠트/], ['tan(270)', /탄젠트/],
  ];
  for (const [expression, pattern] of errors) assert.throws(() => evaluateExpression(expression), pattern, expression);
  assert.throws(() => evaluateExpression('tan(pi/2)', { angleMode: 'RAD' }), /탄젠트/);
  assert.throws(() => evaluateExpression('1', { angleMode: 'bogus' }), /DEG/);
});

test('incomplete or malformed input never partially evaluates', () => {
  for (const expression of ['', ' ', '1+', '2**3', '(1+2', '1+2)', '()', 'sin()', 'sqrt9',
    'sin(1', '2..3', '.', '2 3', '1,234', '1/ /2', ')1(', 'log(2,3)', '1e+', 'sin']) {
    assert.throws(() => evaluateExpression(expression), Error, expression);
  }
});

test('input is parsed as calculator syntax, never as executable JavaScript', () => {
  globalThis.__calculatorEngineProbe = 42;
  for (const expression of ['globalThis.__calculatorEngineProbe=0', 'alert(1)', '1;2',
    'process.exit()', 'constructor.constructor("return 1")()', '[1,2]', '`1`', 'NaN', 'Infinity']) {
    assert.throws(() => evaluateExpression(expression), Error, expression);
  }
  assert.equal(globalThis.__calculatorEngineProbe, 42);
  delete globalThis.__calculatorEngineProbe;
});

test('resource bounds prevent unbounded input and BigInt exponentiation', () => {
  assert.throws(() => evaluateExpression('1'.repeat(2049)), /너무 깁니다/);
  assert.throws(() => evaluateExpression('1'.repeat(1025)), /1024자리/);
  assert.throws(() => evaluateExpression('1e4097'), /지수/);
  assert.throws(() => evaluateExpression('2^1001'), /지수/);
  assert.throws(() => evaluateExpression('(10^1000)^1000'), /계산 범위/);
  assert.throws(() => evaluateExpression('('.repeat(65) + '1' + ')'.repeat(65)), /중첩/);
  assert.throws(() => evaluateExpression('1+'.repeat(300) + '1'), /복잡/);
  exact('10^1000', '1e+1000');
  exact('10^-1000', '1e-1000');
  exact('10^1000 * 10^1000', '1e+2000');
  exact(`${evaluateExpression('10^1000 * 10^1000').value}/1e2000`, '1');
});

test('formatting preserves integer precision, groups digits, and uses decimal rounding', () => {
  assert.equal(formatNumber('1234567.891234567'), '1,234,567.891234567');
  assert.equal(formatNumber('9007199254740993'), '9,007,199,254,740,993');
  assert.equal(formatNumber('1234.50', { grouping: false }), '1234.5');
  assert.equal(formatNumber('1.005', { maxFractionDigits: 2 }), '1.01');
  assert.equal(formatNumber('-1.005', { maxFractionDigits: 2 }), '-1.01');
  assert.equal(formatNumber('999.995', { maxFractionDigits: 2 }), '1,000');
  assert.equal(formatNumber('-0.001', { maxFractionDigits: 2 }), '0');
  assert.equal(formatNumber('0.3333333333333333'), '0.333333333333');
  assert.equal(formatNumber('-0'), '0');
  assert.equal(formatNumber('1.50', { maxFractionDigits: 0 }), '2');
});

test('scientific formatting keeps tiny values visible and supports exact large results', () => {
  assert.equal(formatNumber('1e-1000'), '1e-1000');
  assert.equal(formatNumber('1e+2000'), '1e+2000');
  assert.equal(formatNumber('1.23456789e-7', { maxFractionDigits: 2 }), '1.23e-7');
  assert.equal(formatNumber('9.999e-7', { maxFractionDigits: 2 }), '0.000001');
  assert.equal(formatNumber('100000000000000000000'), '100,000,000,000,000,000,000');
  assert.equal(formatNumber('999999999999999999999.9', { maxFractionDigits: 0 }), '1e+21');
  assert.throws(() => formatNumber('1', { maxFractionDigits: -1 }), /소수 자릿수/);
  assert.throws(() => formatNumber('NaN'), /숫자/);
});
