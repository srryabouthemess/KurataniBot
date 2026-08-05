const { test } = require('node:test');
const assert = require('node:assert/strict');
const { center } = require('../commands/compare');

test('center() pads short strings symmetrically', () => {
  assert.equal(center('abc', 7), '  abc  ');
});

test('center() returns the string unchanged when it already meets the width', () => {
  assert.equal(center('abcdefg', 7), 'abcdefg');
});

test('center() returns the string unchanged when longer than the width', () => {
  assert.equal(center('abcdefgh', 5), 'abcdefgh');
});

test('center() coerces non-string values before padding', () => {
  assert.equal(center(42, 6), '  42  ');
});

test('center() puts the extra padding space on the right when width - length is odd', () => {
  assert.equal(center('ab', 5), ' ab  ');
});
