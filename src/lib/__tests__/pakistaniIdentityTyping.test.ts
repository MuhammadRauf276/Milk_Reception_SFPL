import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePakistaniCnic,
  normalizePakistaniMobile,
  typePakistaniCnic,
  typePakistaniMobile,
} from '../pakistani-identity';

const typedOut = (shape: (v: string) => string, keys: string) =>
  [...keys].reduce((value, key) => shape(value + key), '');

test('a mobile number takes shape as it is typed', () => {
  assert.equal(typedOut(typePakistaniMobile, '03176826604'), '0317-6826604');
  assert.equal(typePakistaniMobile('0317'), '0317');
  assert.equal(typePakistaniMobile('03176'), '0317-6');
});

test('a mobile number stops at 11 digits, and letters are ignored', () => {
  assert.equal(typePakistaniMobile('0317-68266049999'), '0317-6826604');
  assert.equal(typePakistaniMobile('03a17b'), '0317');
});

test('other ways of writing a mobile number become the same shape', () => {
  assert.equal(typePakistaniMobile('+923176826604'), '0317-6826604');
  assert.equal(typePakistaniMobile('923176826604'), '0317-6826604');
  assert.equal(typePakistaniMobile('3176826604'), '0317-6826604');
  assert.equal(typedOut(typePakistaniMobile, '923176826604'), '0317-6826604');
});

test('a CNIC takes shape as it is typed and stops at 13 digits', () => {
  assert.equal(typedOut(typePakistaniCnic, '3310042226039'), '33100-4222603-9');
  assert.equal(typePakistaniCnic('33100'), '33100');
  assert.equal(typePakistaniCnic('331004'), '33100-4');
  assert.equal(typePakistaniCnic('33100-4222603-99999'), '33100-4222603-9');
});

test('removing the last digit never gets stuck on a dash', () => {
  assert.equal(typePakistaniMobile('0317-'), '0317');
  assert.equal(typePakistaniCnic('33100-'), '33100');
  assert.equal(typePakistaniCnic('33100-4222603-'), '33100-4222603');
});

test('empty stays empty', () => {
  assert.equal(typePakistaniMobile(''), '');
  assert.equal(typePakistaniCnic(''), '');
});

test('what the form shows is what the server accepts', () => {
  assert.deepEqual(normalizePakistaniMobile('0317-6826604'), { ok: true, value: '+923176826604' });
  assert.deepEqual(normalizePakistaniCnic('33100-4222603-9'), { ok: true, value: '3310042226039' });
});
