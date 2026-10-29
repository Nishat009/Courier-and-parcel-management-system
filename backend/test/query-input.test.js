const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parsePagination } = require('../src/utils/pagination');
const { optionalQueryString, INVALID_QUERY_STRING } = require('../src/utils/query-string');

test('pagination defaults and returns an offset bounded to safe integer range', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 25, skip: 0 });
  assert.deepEqual(parsePagination({ page: '3', limit: '20' }), { page: 3, limit: 20, skip: 40 });
});

test('pagination clamps limits to endpoint cap', () => {
  assert.deepEqual(parsePagination({ page: '2', limit: '500' }, { maxLimit: 100 }), { page: 2, limit: 100, skip: 100 });
});

test('pagination rejects malformed, repeated, zero and negative parameters', () => {
  for (const query of [
    { page: '1.5' }, { page: '1abc' }, { page: '0' }, { page: '-1' },
    { page: ['1', '2'] }, { limit: ['10', '20'] }, { limit: '' }
  ]) assert.equal(parsePagination(query), null, JSON.stringify(query));
});

test('pagination rejects unsafe values and offsets', () => {
  assert.equal(parsePagination({ page: '9007199254740992' }), null);
  assert.equal(parsePagination({ page: '9007199254740991', limit: '100' }), null);
});

test('optional search query accepts one trimmed value within the configured length', () => {
  assert.equal(optionalQueryString(undefined, 5), '');
  assert.equal(optionalQueryString('  Dhaka  ', 5), 'Dhaka');
});

test('optional search query rejects repeated values and oversized input', () => {
  assert.equal(optionalQueryString(['Dhaka', 'Chattogram'], 40), INVALID_QUERY_STRING);
  assert.equal(optionalQueryString('long search', 5), INVALID_QUERY_STRING);
});
