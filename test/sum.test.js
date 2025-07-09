const sum = require('../sum');

describe('sum', () => {
  test('adds 1 + 2 to equal 3', () => {
    expect(sum(1, 2)).toBe(3);
  });

  test('adds -1 + -1 to equal -2', () => {
    expect(sum(-1, -1)).toBe(-2);
  });

  test('adds 0 + 0 to equal 0', () => {
    expect(sum(0, 0)).toBe(0);
  });

  test('adds positive and negative numbers correctly', () => {
    expect(sum(5, -3)).toBe(2);
    expect(sum(-5, 3)).toBe(-2);
  });

  test('adds decimal numbers correctly', () => {
    expect(sum(0.1, 0.2)).toBeCloseTo(0.3);
    expect(sum(1.5, 2.5)).toBe(4);
  });

  test('adds large numbers correctly', () => {
    expect(sum(1000000, 2000000)).toBe(3000000);
    expect(sum(Number.MAX_SAFE_INTEGER, -1)).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test('handles edge cases', () => {
    expect(sum(0, 0)).toBe(0);
    expect(sum(Infinity, 1)).toBe(Infinity);
    expect(sum(-Infinity, 1)).toBe(-Infinity);
    expect(sum(NaN, 1)).toBeNaN();
  });
});
