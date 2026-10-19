/**
 * Bounded, deterministic calculator expression engine.
 *
 * Basic arithmetic is performed as reduced BigInt fractions. A repeating decimal
 * is rounded only when it is returned to the UI, so (1 / 3) * 3 is exactly 1.
 * Transcendental functions and noninteger powers use JavaScript's Math methods
 * and explicitly mark their results as approximate. No code is evaluated.
 */

const LIMITS = Object.freeze({
  expressionLength: 2048,
  tokens: 512,
  depth: 64,
  literalDigits: 1024,
  literalExponent: 4096,
  power: 1000,
  rationalDigits: 4096,
  outputDigits: 1024,
  factorial: 170,
});

const FUNCTIONS = new Set(['sqrt', 'abs', 'sin', 'cos', 'tan', 'log', 'ln']);
const absInt = (value) => value < 0n ? -value : value;

function fail(message) {
  throw new Error(message);
}

function gcd(a, b) {
  a = absInt(a);
  b = absInt(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function pow10(exponent) {
  return 10n ** BigInt(exponent);
}

function parseDecimal(text, digitLimit = LIMITS.literalDigits,
  exponentLimit = LIMITS.literalExponent) {
  const match = String(text).match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match) fail('올바른 숫자를 입력해 주세요.');
  const integer = match[2] ?? '';
  const fraction = match[3] ?? match[4] ?? '';
  if (integer.length + fraction.length > digitLimit) {
    fail(`한 숫자는 ${digitLimit}자리까지 입력할 수 있습니다.`);
  }
  const exponent = Number(match[5] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > exponentLimit) {
    fail(`지수는 -${exponentLimit}부터 ${exponentLimit}까지 입력할 수 있습니다.`);
  }
  let digits = (integer + fraction).replace(/^0+/, '') || '0';
  let scale = fraction.length - exponent;
  if (digits === '0') return { negative: false, digits: '0', scale: 0 };
  const trailing = digits.match(/0+$/)?.[0].length ?? 0;
  if (trailing) {
    digits = digits.slice(0, -trailing);
    scale -= trailing;
  }
  return { negative: match[1] === '-', digits, scale };
}

function canonicalDecimal(coefficient, scale) {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  let digits = absInt(coefficient).toString();
  const trailing = digits.match(/0+$/)?.[0].length ?? 0;
  if (trailing) {
    digits = digits.slice(0, -trailing);
    scale -= trailing;
  }
  const exponent = digits.length - scale - 1;
  let body;
  if (exponent >= 21 || exponent <= -7) {
    body = digits[0] + (digits.length > 1 ? `.${digits.slice(1)}` : '')
      + `e${exponent >= 0 ? '+' : ''}${exponent}`;
  } else {
    const point = digits.length - scale;
    if (point <= 0) body = `0.${'0'.repeat(-point)}${digits}`;
    else if (point >= digits.length) body = digits + '0'.repeat(point - digits.length);
    else body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return (negative ? '-' : '') + body;
}

class Rational {
  constructor(numerator, denominator = 1n, approximate = false) {
    if (denominator === 0n) fail('0으로 나눌 수 없습니다.');
    if (numerator === 0n) {
      this.n = 0n;
      this.d = 1n;
    } else {
      if (denominator < 0n) {
        numerator = -numerator;
        denominator = -denominator;
      }
      const divisor = gcd(numerator, denominator);
      this.n = numerator / divisor;
      this.d = denominator / divisor;
      if (absInt(this.n).toString().length > LIMITS.rationalDigits
        || this.d.toString().length > LIMITS.rationalDigits) {
        fail('계산 범위를 초과했습니다. 숫자나 지수를 줄여 주세요.');
      }
    }
    this.approximate = approximate;
  }

  static decimal(text, approximate = false) {
    const { negative, digits, scale } = parseDecimal(text);
    let numerator = BigInt(digits) * (negative ? -1n : 1n);
    let denominator = 1n;
    if (scale >= 0) denominator = pow10(scale);
    else numerator *= pow10(-scale);
    return new Rational(numerator, denominator, approximate);
  }

  static number(value) {
    if (!Number.isFinite(value)) fail('이 함수의 계산 범위를 초과했습니다.');
    return Rational.decimal(Object.is(value, -0) ? '0' : value.toPrecision(16), true);
  }

  negate() { return new Rational(-this.n, this.d, this.approximate); }

  add(other) {
    const divisor = gcd(this.d, other.d);
    return new Rational(this.n * (other.d / divisor) + other.n * (this.d / divisor),
      (this.d / divisor) * other.d, this.approximate || other.approximate);
  }

  multiply(other) {
    const first = gcd(this.n, other.d);
    const second = gcd(other.n, this.d);
    return new Rational((this.n / first) * (other.n / second),
      (this.d / second) * (other.d / first), this.approximate || other.approximate);
  }

  divide(other) {
    if (other.n === 0n) fail('0으로 나눌 수 없습니다.');
    return this.multiply(new Rational(other.d, other.n, other.approximate));
  }

  power(other) {
    if (this.n === 0n && other.n === 0n) fail('0의 0제곱은 정의되지 않습니다.');
    if (this.n === 0n && other.n < 0n) fail('0으로 나눌 수 없습니다.');
    if (other.d !== 1n) {
      if (this.n < 0n) fail('음수 밑의 정수가 아닌 거듭제곱은 지원하지 않습니다.');
      const value = Math.pow(this.numberValue(), other.numberValue());
      if (value === 0 && this.n !== 0n) fail('결과가 너무 작아 이 거듭제곱을 계산할 수 없습니다.');
      return Rational.number(value);
    }
    if (absInt(other.n) > BigInt(LIMITS.power)) {
      fail(`거듭제곱의 정수 지수는 -${LIMITS.power}부터 ${LIMITS.power}까지 가능합니다.`);
    }
    const exponent = absInt(other.n);
    if (exponent === 0n) return new Rational(1n, 1n, this.approximate || other.approximate);
    // Avoid constructing an enormous integer only to reject it afterwards.
    for (const component of [absInt(this.n), this.d]) {
      if (component > 1n) {
        const digits = component.toString();
        const head = Number(digits.slice(0, 15)) / (10 ** (Math.min(digits.length, 15) - 1));
        const estimated = (digits.length - 1 + Math.log10(head)) * Number(exponent);
        if (estimated >= LIMITS.rationalDigits) {
          fail('계산 범위를 초과했습니다. 숫자나 지수를 줄여 주세요.');
        }
      }
    }
    const numerator = this.n ** exponent;
    const denominator = this.d ** exponent;
    return other.n < 0n
      ? new Rational(denominator, numerator, this.approximate || other.approximate)
      : new Rational(numerator, denominator, this.approximate || other.approximate);
  }

  roundedString(significantDigits = 16) {
    if (this.n === 0n) return '0';
    const numerator = absInt(this.n);
    let exponent = numerator.toString().length - this.d.toString().length;
    if (exponent >= 0) {
      if (numerator < this.d * pow10(exponent)) exponent--;
    } else if (numerator * pow10(-exponent) < this.d) exponent--;
    const scale = significantDigits - 1 - exponent;
    const scaledNumerator = scale >= 0 ? numerator * pow10(scale) : numerator;
    const scaledDenominator = scale >= 0 ? this.d : this.d * pow10(-scale);
    let rounded = scaledNumerator / scaledDenominator;
    if ((scaledNumerator % scaledDenominator) * 2n >= scaledDenominator) rounded++;
    return canonicalDecimal(this.n < 0n ? -rounded : rounded, scale);
  }

  numberValue() {
    const value = Number(this.roundedString(17));
    if (!Number.isFinite(value)) fail('값이 너무 커서 이 함수를 계산할 수 없습니다.');
    if (value === 0 && this.n !== 0n) fail('값이 너무 작아 이 함수를 계산할 수 없습니다.');
    return value;
  }

  result() {
    let denominator = this.d;
    let twos = 0;
    let fives = 0;
    while (denominator % 2n === 0n) { denominator /= 2n; twos++; }
    while (denominator % 5n === 0n) { denominator /= 5n; fives++; }
    if (denominator !== 1n) return { value: this.roundedString(), approximate: true };
    const scale = Math.max(twos, fives);
    const coefficient = this.n * (2n ** BigInt(scale - twos)) * (5n ** BigInt(scale - fives));
    // Count meaningful digits, not the zeros that scientific notation removes.
    const meaningfulDigits = absInt(coefficient).toString().replace(/0+$/, '').length;
    if (meaningfulDigits > LIMITS.outputDigits) {
      return { value: this.roundedString(), approximate: true };
    }
    return { value: canonicalDecimal(coefficient, scale), approximate: this.approximate };
  }
}

function integerSqrt(value) {
  if (value < 2n) return value;
  let previous = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  let next = (previous + value / previous) >> 1n;
  while (next < previous) {
    previous = next;
    next = (previous + value / previous) >> 1n;
  }
  return previous;
}

function factorial(value) {
  if (value.d !== 1n || value.n < 0n) fail('팩토리얼은 0 이상의 정수에만 사용할 수 있습니다.');
  if (value.n > BigInt(LIMITS.factorial)) fail(`팩토리얼은 ${LIMITS.factorial}까지 계산할 수 있습니다.`);
  let result = 1n;
  for (let factor = 2n; factor <= value.n; factor++) result *= factor;
  return new Rational(result, 1n, value.approximate);
}

function scientific(name, input, angleMode) {
  if (name === 'abs') return new Rational(absInt(input.n), input.d, input.approximate);
  if (name === 'sqrt') {
    if (input.n < 0n) fail('음수의 제곱근은 실수로 계산할 수 없습니다.');
    const n = integerSqrt(input.n);
    const d = integerSqrt(input.d);
    if (n * n === input.n && d * d === input.d) return new Rational(n, d, input.approximate);
    return Rational.number(Math.sqrt(input.numberValue()));
  }
  if (name === 'ln' || name === 'log') {
    if (input.n <= 0n) fail('로그에는 0보다 큰 숫자를 입력해 주세요.');
    return Rational.number(name === 'ln' ? Math.log(input.numberValue()) : Math.log10(input.numberValue()));
  }
  let angle;
  let quarterTurns = null;
  if (angleMode === 'DEG') {
    // Reducing degrees before conversion also handles very large exact angles.
    const reduced = new Rational(input.n % (360n * input.d), input.d, input.approximate);
    if (reduced.n % (90n * reduced.d) === 0n) quarterTurns = Number(reduced.n / (90n * reduced.d));
    angle = reduced.numberValue() * (Math.PI / 180);
  } else {
    angle = input.numberValue();
    if (Math.abs(angle) > 1e12) fail('라디안 각도가 너무 큽니다. 각도를 줄여 주세요.');
    const turns = angle / (Math.PI / 2);
    if (Number.isInteger(turns)) quarterTurns = turns;
  }
  if (quarterTurns !== null) {
    const quadrant = ((quarterTurns % 4) + 4) % 4;
    if (name === 'sin') return new Rational(BigInt([0, 1, 0, -1][quadrant]), 1n, true);
    if (name === 'cos') return new Rational(BigInt([1, 0, -1, 0][quadrant]), 1n, true);
    if (quadrant % 2 === 1) fail('이 각도에서 탄젠트는 정의되지 않습니다.');
    return new Rational(0n, 1n, true);
  }
  if (name === 'tan' && Math.abs(Math.cos(angle)) < 1e-15) {
    fail('이 각도에서 탄젠트는 정의되지 않거나 수치적으로 불안정합니다.');
  }
  return Rational.number(Math[name](angle));
}

function tokenize(expression) {
  if (typeof expression !== 'string') fail('계산할 수식을 입력해 주세요.');
  if (expression.length > LIMITS.expressionLength) fail('수식이 너무 깁니다. 나누어 계산해 주세요.');
  const text = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/√/g, 'sqrt');
  const tokens = [];
  for (let position = 0; position < text.length;) {
    const character = text[position];
    if (/\s/.test(character)) { position++; continue; }
    let token;
    if (/[\d.]/.test(character)) {
      const number = text.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0];
      if (!number) fail('소수점 앞뒤의 숫자를 확인해 주세요.');
      token = { type: 'number', value: number };
      if (tokens.at(-1)?.type === 'number') fail('숫자 사이에 연산자를 넣어 주세요.');
      position += number.length;
    } else if (/[a-zA-Z]/.test(character)) {
      const name = text.slice(position).match(/^[a-zA-Z]+/)[0].toLowerCase();
      if (name === 'pi' || name === 'e') token = { type: 'constant', value: name };
      else if (FUNCTIONS.has(name)) token = { type: 'function', value: name };
      else fail(`지원하지 않는 함수 또는 이름입니다: ${name}`);
      position += name.length;
    } else if (character === 'π') {
      token = { type: 'constant', value: 'pi' };
      position++;
    } else if ('+-*/^()%!'.includes(character)) {
      token = { type: character, value: character };
      position++;
    } else fail(`수식에 사용할 수 없는 문자입니다: ${character}`);
    tokens.push(token);
    if (tokens.length > LIMITS.tokens) fail('수식이 너무 복잡합니다. 나누어 계산해 주세요.');
  }
  tokens.push({ type: 'end', value: '' });
  return tokens;
}

class Parser {
  constructor(tokens, angleMode) {
    this.tokens = tokens;
    this.position = 0;
    this.angleMode = angleMode;
    this.depth = 0;
  }

  peek() { return this.tokens[this.position]; }
  take() { return this.tokens[this.position++]; }

  expression(minimumBinding = 0) {
    if (++this.depth > LIMITS.depth) fail('괄호나 거듭제곱이 너무 깊게 중첩되어 있습니다.');
    const token = this.take();
    let left;
    if (token.type === 'number') left = Rational.decimal(token.value);
    else if (token.type === 'constant') left = Rational.number(token.value === 'pi' ? Math.PI : Math.E);
    else if (token.type === '+' || token.type === '-') {
      left = this.expression(30);
      if (token.type === '-') left = left.negate();
    } else if (token.type === '(') {
      left = this.expression();
      if (this.take().type !== ')') fail('닫는 괄호가 필요합니다.');
    } else if (token.type === 'function') {
      if (this.take().type !== '(') fail(`${token.value} 함수는 괄호 안에 숫자나 수식을 입력해 주세요.`);
      const argument = this.expression();
      if (this.take().type !== ')') fail('함수의 닫는 괄호가 필요합니다.');
      left = scientific(token.value, argument, this.angleMode);
    } else fail('숫자나 여는 괄호가 필요한 위치입니다. 수식을 확인해 주세요.');

    while (true) {
      const next = this.peek();
      if (!next) fail('괄호와 수식의 끝을 확인해 주세요.');
      if (next.type === '%' || next.type === '!') {
        if (50 < minimumBinding) break;
        this.take();
        left = next.type === '%' ? left.divide(new Rational(100n)) : factorial(left);
        continue;
      }
      let operator = next.type;
      let implicit = false;
      if (['number', 'constant', 'function', '('].includes(operator)) {
        operator = '*';
        implicit = true;
      }
      const binding = operator === '+' || operator === '-' ? 10
        : operator === '*' || operator === '/' ? 20 : operator === '^' ? 40 : -1;
      if (binding < minimumBinding) break;
      if (!implicit) this.take();
      const right = this.expression(operator === '^' ? binding : binding + 1);
      if (operator === '+') left = left.add(right);
      else if (operator === '-') left = left.add(right.negate());
      else if (operator === '*') left = left.multiply(right);
      else if (operator === '/') left = left.divide(right);
      else left = left.power(right);
    }
    this.depth--;
    return left;
  }
}

/**
 * Evaluate a calculator expression. Percent is a postfix division by 100:
 * 200 + 10% = 200.1. Implicit multiplication has ordinary * / precedence.
 * ^ is right associative, binds above unary -, and accepts signed exponents.
 */
export function evaluateExpression(expression, { angleMode = 'DEG' } = {}) {
  if (angleMode !== 'DEG' && angleMode !== 'RAD') fail('각도 모드는 DEG 또는 RAD여야 합니다.');
  const parser = new Parser(tokenize(expression), angleMode);
  const result = parser.expression();
  if (parser.peek().type !== 'end') fail('불필요한 닫는 괄호 또는 잘못된 연산자가 있습니다.');
  return result.result();
}

/** Format a normalized result without converting it through binary floating point. */
export function formatNumber(value, { maxFractionDigits = 12, grouping = true } = {}) {
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > 100) {
    fail('표시할 소수 자릿수는 0부터 100까지의 정수여야 합니다.');
  }
  const parsed = parseDecimal(String(value), LIMITS.outputDigits + 64, LIMITS.rationalDigits * 4);
  if (parsed.digits === '0') return '0';
  const exponent = parsed.digits.length - parsed.scale - 1;
  const significant = exponent >= 21 || exponent <= -7;
  const targetDigits = significant ? maxFractionDigits + 1 : null;
  const removed = significant ? parsed.digits.length - targetDigits : parsed.scale - maxFractionDigits;
  let coefficient = BigInt(parsed.digits);
  let scale = parsed.scale;
  if (removed > 0) {
    const divisor = pow10(removed);
    const remainder = coefficient % divisor;
    coefficient /= divisor;
    if (remainder * 2n >= divisor) coefficient++;
    scale -= removed;
  }
  if (parsed.negative) coefficient = -coefficient;
  const formatted = canonicalDecimal(coefficient, scale);
  if (!grouping || formatted.includes('e')) return formatted;
  const [integer, fraction] = formatted.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
