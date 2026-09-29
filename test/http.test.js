import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { creerApplication } from '../src/server.js';

let serveur;
let base;
const H = 'x-auth-request-email';

before(async () => {
  const service = new Service(new Store(null), { maintenant: () => new Date('2026-09-29T10:00:00Z') });
  Object.assign(service.e.parametres, { saison: { debut: '2026-01-01', fin: '2026-12-31' }, ratioMetresParContrat: 10 });
  service.importerAnnuaire([{ email: 'lea@ex.fr', prenom: 'Léa', nom: 'Martin', couloir: 'crc' }]);
  service.modifierParametres({ administrateurs: ['admin@ex.fr'] });
  serveur = createServer(creerApplication({ service, ingestToken: 'secret-ingest', dashboardToken: 'secret-ecran' }));
  await new Promise((r) => serveur.listen(0, r));
  base = `http://127.0.0.1:${serveur.address().port}`;
});
after(() => serveur.close());

const appel = (chemin, { email, methode = 'GET', corps, entetes = {} } = {}) =>
  fetch(base + chemin, {
    method: methode,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'defi', ...(email ? { [H]: email } : {}), ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });

test('SSO requis ; parcours inscription puis déclaration', async () => {
  assert.equal((await appel('/api/session')).status, 401);
  assert.equal((await appel('/api/accueil', { email: 'lea@ex.fr' })).status, 403);
  const r = await appel('/api/inscription', { email: 'lea@ex.fr', methode: 'POST', corps: { affichage: 'initiales', consentementRgpd: true } });
  assert.equal(r.status, 200);
  const s = await appel('/api/sorties', { email: 'lea@ex.fr', methode: 'POST', corps: { activite: 'course', distanceKm: 5.2 } });
  assert.equal((await s.json()).metresComptes, 5200);
  const a = await (await appel('/api/accueil', { email: 'lea@ex.fr' })).json();
  assert.equal(a.contributionSemaine, 5200);
  const fil = await (await appel('/api/fil', { email: 'lea@ex.fr' })).json();
  assert.equal(fil[0].auteur, 'LM');
});

test('écritures sans en-tête anti-CSRF refusées', async () => {
  const r = await fetch(`${base}/api/sorties`, { method: 'POST', headers: { [H]: 'lea@ex.fr' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('back-office réservé à l’administrateur', async () => {
  assert.equal((await appel('/api/admin/parametres', { email: 'lea@ex.fr' })).status, 403);
  assert.equal((await appel('/api/admin/parametres', { email: 'admin@ex.fr' })).status, 200);
  const csv = await appel('/api/admin/export.csv', { email: 'admin@ex.fr' });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
});

test('ingestion des contrats par jeton', async () => {
  assert.equal((await appel('/api/ingest/contrats', { methode: 'POST', corps: { date: '2026-09-28', nombre: 48 } })).status, 401);
  const r = await appel('/api/ingest/contrats', {
    methode: 'POST',
    corps: [{ date: '2026-09-28', nombre: 48 }],
    entetes: { authorization: 'Bearer secret-ingest' },
  });
  assert.equal(r.status, 200);
  const t = await (await appel('/api/tableau-de-bord?jeton=secret-ecran')).json();
  assert.equal(t.compteur.dus, 480);
});

test('fichiers statiques et en-têtes de sécurité', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 404);
});

test('administration : pilotage, collaborateurs, correction, journal', async () => {
  const admin = { email: 'admin@ex.fr' };
  const p = await (await appel('/api/admin/pilotage', admin)).json();
  assert.ok(Array.isArray(p.evolution) && p.projection.disponible);
  const liste = await (await appel('/api/admin/collaborateurs', admin)).json();
  const lea = liste.find((x) => x.email === 'lea@ex.fr');
  const fiche = await (await appel(`/api/admin/collaborateurs/${lea.id}`, admin)).json();
  const sortie = fiche.sorties[0];
  const r = await appel(`/api/admin/sorties/${sortie.id}`, { ...admin, methode: 'PATCH', corps: { distanceKm: 6 } });
  assert.equal((await r.json()).metresComptes, 6000);
  assert.equal((await appel(`/api/admin/sorties/${sortie.id}`, { email: 'lea@ex.fr', methode: 'DELETE' })).status, 403);
  const journal = await (await appel('/api/admin/journal', admin)).json();
  assert.deepEqual(journal.slice(0, 2).map((j) => j.action), ['Sortie corrigée', 'Historique consulté']);
  const synchro = await appel('/api/admin/contrats/synchroniser', { ...admin, methode: 'POST', corps: {} });
  assert.equal(synchro.status, 409);
});
