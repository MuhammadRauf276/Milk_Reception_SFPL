import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoadRoute, resetRoadRouteCache, routeKey, routingBaseUrl, MAX_ROUTE_POINTS } from '@/backend/services/map/roadRouteService';
import { formatPosition, isValidPosition, parsePositionText, readPositionInput, toPosition } from '@/lib/coordinates';

const ZMCC = { latitude: 29.6974, longitude: 72.5539 };
const SHOP = { latitude: 29.71, longitude: 72.6 };

function okAnswer(coords: Array<[number, number]>) {
  return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 5200, duration: 600, geometry: { coordinates: coords } }] }) } as unknown as Response;
}

test('a location is two real numbers: latitude, longitude', () => {
  assert.deepEqual(parsePositionText('29.6974, 72.5539'), ZMCC);
  assert.deepEqual(parsePositionText(' 29.6974   72.5539 '), ZMCC);
  assert.equal(parsePositionText('29.6974'), null);
  assert.equal(parsePositionText('abc, def'), null);
  assert.equal(parsePositionText('95, 72'), null); // latitude out of range
  assert.equal(parsePositionText('0, 0'), null); // the empty value
  assert.equal(parsePositionText(''), null);
  assert.equal(formatPosition(ZMCC), '29.6974, 72.5539');
  assert.equal(formatPosition({ latitude: null, longitude: 72 }), '');
  assert.equal(isValidPosition(29.7, 72.5), true);
  assert.equal(isValidPosition('29.7', 72.5), false);
  assert.deepEqual(toPosition('29.6974000', '72.5539000'), ZMCC); // database decimals arrive as text
  assert.equal(toPosition(null, 72.5), null);
});

test('saving a location: both parts together, null clears it, leaving it out keeps it', () => {
  assert.deepEqual(readPositionInput(undefined, undefined), { ok: true, value: undefined });
  assert.deepEqual(readPositionInput(null, null), { ok: true, value: null });
  assert.deepEqual(readPositionInput(29.6974, 72.5539), { ok: true, value: ZMCC });
  assert.equal(readPositionInput(29.6974, undefined).ok, false);
  assert.equal(readPositionInput(29.6974, null).ok, false);
  assert.equal(readPositionInput(120, 72).ok, false);
});

test('the routing engine is the public one unless set, and "off" turns road paths off', () => {
  assert.equal(routingBaseUrl({}), 'https://router.project-osrm.org');
  assert.equal(routingBaseUrl({ MAP_ROUTING_URL: 'http://osrm:5000/' }), 'http://osrm:5000');
  assert.equal(routingBaseUrl({ MAP_ROUTING_URL: 'off' }), null);
  assert.equal(routeKey([ZMCC, SHOP]), '72.55390,29.69740;72.60000,29.71000'); // longitude first
  assert.equal(routeKey([ZMCC]), null);
  assert.equal(routeKey(Array.from({ length: MAX_ROUTE_POINTS + 1 }, () => ZMCC)), null);
  assert.equal(routeKey([ZMCC, { latitude: 0, longitude: 0 }]), null);
});

test('a road path is fetched once, then reused; only coordinates are sent', async () => {
  resetRoadRouteCache();
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return okAnswer([[72.5539, 29.6974], [72.57, 29.70], [72.6, 29.71]]);
  }) as unknown as typeof fetch;

  const first = await getRoadRoute([ZMCC, SHOP], { fetchImpl, env: { MAP_ROUTING_URL: 'http://osrm:5000' } });
  assert.equal(first?.coordinates.length, 3);
  assert.equal(first?.distanceM, 5200);
  const again = await getRoadRoute([ZMCC, SHOP], { fetchImpl, env: { MAP_ROUTING_URL: 'http://osrm:5000' } });
  assert.deepEqual(again, first);
  assert.equal(urls.length, 1, 'the second request is answered from memory');
  assert.equal(urls[0], 'http://osrm:5000/route/v1/driving/72.55390,29.69740;72.60000,29.71000?overview=full&geometries=geojson&steps=false');
});

test('no engine, no answer or a bad answer all mean straight lines, never an error', async () => {
  resetRoadRouteCache();
  let calls = 0;
  const failing = (async () => {
    calls++;
    throw new Error('network down');
  }) as unknown as typeof fetch;
  let clock = 1_000_000;
  const now = () => clock;

  assert.equal(await getRoadRoute([ZMCC, SHOP], { fetchImpl: failing, env: { MAP_ROUTING_URL: 'off' } }), null);
  assert.equal(calls, 0, 'switched off: nothing is asked');

  assert.equal(await getRoadRoute([ZMCC, SHOP], { fetchImpl: failing, now, env: {} }), null);
  assert.equal(calls, 1);
  // Straight after a failure the engine is left alone for a minute.
  assert.equal(await getRoadRoute([ZMCC, SHOP], { fetchImpl: failing, now, env: {} }), null);
  assert.equal(calls, 1);
  clock += 61_000;
  const bad = (async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ code: 'NoRoute', routes: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;
  assert.equal(await getRoadRoute([ZMCC, SHOP], { fetchImpl: bad, now, env: {} }), null);
  assert.equal(calls, 2);
});
