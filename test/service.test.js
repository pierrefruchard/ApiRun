import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';

function contexte(date = '2026-09-29T10:00:00Z') {
  const store = new Store(null);
  let horloge = new Date(date);
  const service = new Service(store, { maintenant: () => horloge });
  Object.assign(store.etat.parametres, { saison: { debut: '2026-01-01', fin: '2026-12-31' }, ratioMetresParContrat: 10 });
  service.importerAnnuaire([
    { email: 'lea.martin@ex.fr', prenom: 'Léa', nom: 'Martin', couloir: 'crc' },
    { email: 'hugo.petit@ex.fr', prenom: 'Hugo', nom: 'Petit', couloir: 'dsi' },
  ]);
  const inscrire = (email, extra = {}) => service.inscrire(email, { affichage: 'prenom', consentementRgpd: true, ...extra });
  return { store, service, inscrire, avancer: (d) => (horloge = new Date(d)) };
}

test('inscription : consentement obligatoire, couloir pré-rempli, annuaire requis', () => {
  const { service, inscrire } = contexte();
  assert.throws(() => service.inscrire('lea.martin@ex.fr', { affichage: 'prenom', consentementRgpd: false }), /consentement/);
  assert.throws(() => inscrire('inconnu@ex.fr'), /annuaire/);
  const u = inscrire('Lea.Martin@ex.fr');
  assert.equal(u.couloir, 'crc');
  assert.equal(u.couloirModifie, false);
  assert.throws(() => inscrire('lea.martin@ex.fr'), /Déjà inscrit/);
});

test('couloir modifiable une seule fois', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  service.modifierProfil(u, { couloir: 'sante' });
  assert.throws(() => service.modifierProfil(u, { couloir: 'iard' }), /déjà été modifié/);
  const h = inscrire('hugo.petit@ex.fr', { couloir: 'transfo' });
  assert.equal(h.couloirModifie, true);
});

test('déclaration : pondération, plafond journalier et file de validation', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  const s1 = service.declarerSortie(u, { activite: 'velo', distanceKm: 60, date: '2026-09-29' });
  assert.equal(s1.metresComptes, 20000);
  const s2 = service.declarerSortie(u, { activite: 'course', distanceKm: 15, date: '2026-09-29' });
  assert.equal(s2.metresComptes, 10000);
  assert.equal(s2.metresEnAttente, 5000);
  assert.equal(service.fileHorsPlafond().length, 1);
  service.traiterHorsPlafond(s2.id, 'valider');
  assert.equal(service.compteur().courus, 35000);
  const s3 = service.declarerSortie(u, { activite: 'marche', distanceKm: 3, date: '2026-09-29' });
  assert.equal(s3.metresEnAttente, 3000);
  service.traiterHorsPlafond(s3.id, 'refuser');
  assert.equal(service.compteur().courus, 35000);
  assert.equal(service.declarerSortie(u, { activite: 'marche', distanceKm: 3, date: '2026-09-28' }).metresComptes, 3000);
});

test('déclaration : dates futures, hors saison et distances aberrantes refusées', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  assert.throws(() => service.declarerSortie(u, { activite: 'course', distanceKm: 5, date: '2026-09-30' }), /futur/);
  assert.throws(() => service.declarerSortie(u, { activite: 'course', distanceKm: 5, date: '2025-12-31' }), /hors saison/);
  assert.throws(() => service.declarerSortie(u, { activite: 'course', distanceKm: 0 }), /Distance/);
  assert.throws(() => service.declarerSortie(u, { activite: 'course', distanceKm: 1000 }), /Distance/);
});

test('contrats : total du jour idempotent, publication du lot dans le fil', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  service.enregistrerContrats('2026-09-28', 48);
  service.enregistrerContrats('2026-09-28', 48);
  service.enregistrerContrats('2026-09-29', 30);
  const c = service.compteur();
  assert.equal(c.dus, 780);
  const lots = service.fil(u).filter((f) => f.type === 'contrats');
  assert.equal(lots.length, 2);
  assert.ok(lots.some((f) => f.metres === 480));
});

test('paliers franchis publiés une seule fois dans le fil', () => {
  const { service, inscrire } = contexte();
  service.modifierParametres({ contratsAnnuelsPrevus: 1000 }); // objectif 10 km
  const u = inscrire('lea.martin@ex.fr');
  service.declarerSortie(u, { activite: 'course', distanceKm: 3, date: '2026-09-27' });
  service.declarerSortie(u, { activite: 'course', distanceKm: 3, date: '2026-09-28' });
  const paliers = service.fil(u).filter((f) => f.type === 'palier').map((f) => f.pourcentage).sort((a, b) => a - b);
  assert.deepEqual(paliers, [25, 50]);
});

test('encouragements : un par sortie, pas sur soi-même, badge moteur', () => {
  const { service, inscrire } = contexte();
  const lea = inscrire('lea.martin@ex.fr');
  const hugo = inscrire('hugo.petit@ex.fr');
  const s = service.declarerSortie(lea, { activite: 'marche', distanceKm: 2 });
  assert.throws(() => service.encourager(lea, s.id), /autres/);
  assert.equal(service.encourager(hugo, s.id).deja, false);
  assert.equal(service.encourager(hugo, s.id).deja, true);
  const item = service.fil(hugo).find((f) => f.type === 'sortie');
  assert.equal(item.encouragements, 1);
  assert.equal(item.dejaEncourage, true);
  assert.equal(item.auteur, 'Léa');
});

test('badges privés, partage au choix', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  assert.throws(() => service.partagerBadge(u, 'premiere-sortie'), /non obtenu/);
  service.declarerSortie(u, { activite: 'marche', distanceKm: 2 });
  assert.equal(service.fil(u).filter((f) => f.type === 'badge').length, 0);
  service.partagerBadge(u, 'premiere-sortie');
  assert.equal(service.fil(u).filter((f) => f.type === 'badge').length, 1);
});

test('désinscription : données personnelles supprimées, mètres conservés anonymisés', () => {
  const { service, inscrire } = contexte();
  const lea = inscrire('lea.martin@ex.fr');
  const hugo = inscrire('hugo.petit@ex.fr');
  const s = service.declarerSortie(lea, { activite: 'course', distanceKm: 5 });
  service.encourager(hugo, s.id);
  service.desinscrire(hugo);
  service.desinscrire(lea);
  assert.equal(service.utilisateurParEmail('lea.martin@ex.fr'), null);
  assert.equal(service.compteur().courus, 5000);
  assert.equal(service.e.sorties[0].userId, null);
  assert.equal(service.e.encouragements.length, 0);
  assert.equal(service.classement(null).saison.find((c) => c.couloir === 'crc').metres, 5000);
  assert.ok(!JSON.stringify(service.e.utilisateurs).includes('lea'));
});

test('purge RGPD 3 mois après la fin de saison', () => {
  const { service, inscrire, avancer } = contexte();
  inscrire('lea.martin@ex.fr');
  assert.equal(service.purgeRgpd().purge, false);
  avancer('2027-04-01T00:00:00Z');
  assert.deepEqual(service.purgeRgpd(), { purge: true, echeance: '2027-03-31' });
  assert.equal(service.e.utilisateurs.length, 0);
  assert.equal(service.e.annuaire.length, 0);
});

test('tableau de bord : indicateurs de pilotage du cahier des charges', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  service.enregistrerContrats('2026-09-01', 100);
  service.declarerSortie(u, { activite: 'course', distanceKm: 20, date: '2026-09-20' });
  const t = service.tableauDeBord();
  assert.equal(t.compteur.ecart, 19000);
  assert.equal(t.indicateurs.ecartPositif, true);
  assert.equal(t.indicateurs.participationMois.actifs, 1);
  assert.equal(t.indicateurs.couloirsAuSeuil, 1);
});

test('export CSV sans donnée nominative', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea.martin@ex.fr');
  service.declarerSortie(u, { activite: 'velo', distanceKm: 9, date: '2026-09-29' });
  const csv = service.exportCsv();
  assert.match(csv, /^date;couloir;activite/);
  assert.match(csv, /2026-09-29;crc;velo;9000;3000;3000;0;/);
  assert.ok(!csv.includes('lea'));
});
