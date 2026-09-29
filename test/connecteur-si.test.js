import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { configurationSi, synchroniserContrats } from '../src/connecteurs/contrats-si.js';

const env = { SI_API_URL: 'https://si.ex/contrats?jour={date}', SI_API_KEY: 'cle', SI_CHAMP_NOMBRE: 'data.total', SI_JOURS_RATTRAPAGE: '3' };

function contexte() {
  const service = new Service(new Store(null), { maintenant: () => new Date('2027-01-08T07:00:00Z') });
  return service;
}

test('configuration : absente, incomplète, valide', () => {
  assert.equal(configurationSi({}), null);
  assert.throws(() => configurationSi({ SI_API_URL: 'https://x/{date}' }), /SI_API_KEY/);
  assert.throws(() => configurationSi({ SI_API_URL: 'https://x', SI_API_KEY: 'k' }), /\{date\}/);
  assert.equal(configurationSi(env).entete, 'x-api-key');
});

test('synchronisation : clé en en-tête, jours complets de la saison seulement, idempotente', async () => {
  const service = contexte();
  const appels = [];
  const fetchImpl = async (url, opts) => {
    appels.push({ url, cle: opts.headers['x-api-key'] });
    const jour = new URL(url).searchParams.get('jour');
    return { ok: true, json: async () => ({ data: { total: { '2027-01-05': 70, '2027-01-06': 80, '2027-01-07': 90 }[jour] } }) };
  };
  const r = await synchroniserContrats(service, configurationSi(env), { fetchImpl });
  assert.equal(r.erreur, null);
  assert.deepEqual(appels.map((a) => a.url), [
    'https://si.ex/contrats?jour=2027-01-05',
    'https://si.ex/contrats?jour=2027-01-06',
    'https://si.ex/contrats?jour=2027-01-07',
  ]);
  assert.ok(appels.every((a) => a.cle === 'cle'));
  assert.equal(service.compteur().dus, 240);
  const r2 = await synchroniserContrats(service, configurationSi(env), { fetchImpl });
  assert.equal(r2.joursMisAJour, 0);
  assert.equal(service.fil(null).filter((f) => f.type === 'contrats').length, 3);
});

test('synchronisation : jours avant le début de saison ignorés', async () => {
  const service = new Service(new Store(null), { maintenant: () => new Date('2027-01-05T07:00:00Z') });
  const appels = [];
  await synchroniserContrats(service, configurationSi(env), {
    fetchImpl: async (url) => (appels.push(url), { ok: true, json: async () => ({ data: { total: 10 } }) }),
  });
  assert.equal(appels.length, 1);
});

test('synchronisation : erreur API remontée sans casser l’état', async () => {
  const service = contexte();
  const r = await synchroniserContrats(service, configurationSi(env), { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.match(r.erreur, /HTTP 503/);
  assert.equal(service.e.syncContrats.erreur, r.erreur);
  const r2 = await synchroniserContrats(service, configurationSi(env), {
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { total: 'beaucoup' } }) }),
  });
  assert.match(r2.erreur, /total invalide/);
});
