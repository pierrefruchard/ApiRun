import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { parametresParDefaut } from '../src/config.js';

function contexte(date = '2026-09-29T10:00:00Z') {
  const store = new Store(null);
  let horloge = new Date(date);
  const service = new Service(store, { maintenant: () => horloge });
  Object.assign(store.etat.parametres, { saison: { debut: '2026-01-01', fin: '2026-12-31' }, ratioMetresParContrat: 10 });
  service.importerAnnuaire([
    { email: 'lea@ex.fr', prenom: 'Léa', nom: 'Martin', couloir: 'crc' },
    { email: 'hugo@ex.fr', prenom: 'Hugo', nom: 'Petit', couloir: 'dsi' },
    { email: 'nora@ex.fr', prenom: 'Nora', nom: 'Simon', couloir: 'dsi' },
  ]);
  const inscrire = (email) => service.inscrire(email, { affichage: 'prenom', consentementRgpd: true });
  return { service, inscrire, avancer: (d) => (horloge = new Date(d)) };
}

test('décisions : ratio 1 m, saison 2027 au 4 janvier, paliers symboliques', () => {
  const p = parametresParDefaut();
  assert.equal(p.ratioMetresParContrat, 1);
  assert.deepEqual(p.saison, { debut: '2027-01-04', fin: '2027-12-31' });
  assert.ok(p.paliers.every((x) => x.recompense === ''));
});

test('avant la saison : déclaration refusée, accueil signale le démarrage', () => {
  const store = new Store(null);
  const service = new Service(store, { maintenant: () => new Date('2026-12-15T10:00:00Z') });
  service.importerAnnuaire([{ email: 'lea@ex.fr', prenom: 'Léa', nom: 'Martin', couloir: 'crc' }]);
  const u = service.inscrire('lea@ex.fr', { affichage: 'prenom', consentementRgpd: true });
  assert.throws(() => service.declarerSortie(u, { activite: 'course', distanceKm: 5 }), /hors saison/);
  assert.equal(service.accueil(u).avantSaison, true);
});

test('correction d’une déclaration : recalcul, plafond, fil et journal', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea@ex.fr');
  const s = service.declarerSortie(u, { activite: 'course', distanceKm: 8, date: '2026-09-28' });
  service.corrigerSortie(s.id, { activite: 'velo', distanceKm: 30 }, 'admin@ex.fr');
  assert.equal(service.e.sorties[0].metresComptes, 10000);
  assert.equal(service.fil(u).find((f) => f.type === 'sortie').metres, 10000);
  service.corrigerSortie(s.id, { activite: 'course', distanceKm: 40 }, 'admin@ex.fr');
  assert.equal(service.e.sorties[0].metresComptes, 30000);
  assert.equal(service.e.sorties[0].metresEnAttente, 10000);
  assert.throws(() => service.corrigerSortie(s.id, { date: '2026-10-05' }, 'admin@ex.fr'), /futur/);
  const j = service.e.journal.filter((x) => x.action === 'Sortie corrigée');
  assert.equal(j.length, 2);
  assert.equal(j[0].acteur, 'admin@ex.fr');
  assert.match(j[0].details, /course 8 km le 2026-09-28 → velo 30 km/);
});

test('suppression d’une déclaration : compteur, fil et encouragements nettoyés', () => {
  const { service, inscrire } = contexte();
  const lea = inscrire('lea@ex.fr');
  const hugo = inscrire('hugo@ex.fr');
  const s = service.declarerSortie(lea, { activite: 'course', distanceKm: 5 });
  service.encourager(hugo, s.id);
  service.supprimerSortie(s.id, 'admin@ex.fr');
  assert.equal(service.compteur().courus, 0);
  assert.equal(service.fil(lea).filter((f) => f.type === 'sortie').length, 0);
  assert.equal(service.e.encouragements.length, 0);
});

test('historique individuel tracé ; désinscription par l’administrateur anonymise le journal', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea@ex.fr');
  service.declarerSortie(u, { activite: 'marche', distanceKm: 3 });
  const fiche = service.ficheCollaborateur(u.id, 'admin@ex.fr');
  assert.equal(fiche.sorties.length, 1);
  assert.ok(service.e.journal.some((j) => j.action === 'Historique consulté' && j.details === 'Léa Martin'));
  service.desinscrireParAdmin(u.id, 'admin@ex.fr');
  assert.equal(service.utilisateurParEmail('lea@ex.fr'), null);
  assert.equal(service.compteur().courus, 3000);
  assert.ok(!JSON.stringify(service.e.journal).includes('Léa'));
});

test('liste des collaborateurs : activité et inactivité à 14 jours', () => {
  const { service, inscrire } = contexte();
  const lea = inscrire('lea@ex.fr');
  const hugo = inscrire('hugo@ex.fr');
  inscrire('nora@ex.fr');
  service.declarerSortie(lea, { activite: 'course', distanceKm: 5, date: '2026-09-25' });
  service.declarerSortie(hugo, { activite: 'course', distanceKm: 5, date: '2026-09-10' });
  const l = Object.fromEntries(service.listeCollaborateurs().map((x) => [x.prenom, x]));
  assert.equal(l.Léa.inactif14j, false);
  assert.equal(l.Hugo.inactif14j, true);
  assert.equal(l.Nora.derniereSortie, null);
  const dsi = service.attrition().find((c) => c.couloir === 'dsi');
  assert.deepEqual({ ...dsi }, { couloir: 'dsi', nom: 'DSI · RSSI', inscrits: 2, jamaisSortis: 1, inactifs14j: 1, actifs14j: 0 });
});

test('pilotage : évolution hebdomadaire cumulée', () => {
  const { service, inscrire } = contexte();
  const u = inscrire('lea@ex.fr');
  service.enregistrerContrats('2026-09-21', 100);
  service.enregistrerContrats('2026-09-28', 50);
  service.declarerSortie(u, { activite: 'course', distanceKm: 2, date: '2026-09-22' });
  service.declarerSortie(u, { activite: 'course', distanceKm: 3, date: '2026-09-29' });
  const ev = service.evolutionHebdomadaire();
  assert.equal(ev[0].debut, '2026-01-01');
  const [w39, w40] = ev.slice(-2);
  assert.equal(w39.semaine, '2026-W39');
  assert.deepEqual([w39.courus, w39.dus, w39.sorties, w39.actifs], [2000, 1000, 1, 1]);
  assert.deepEqual([w40.cumulCourus, w40.cumulDus, w40.ecart], [5000, 1500, 3500]);
});

test('pilotage : projection au rythme des 28 derniers jours', () => {
  const { service, inscrire } = contexte('2026-12-03T10:00:00Z');
  service.modifierParametres({ contratsAnnuelsPrevus: 1000 }); // objectif 10 km
  const u = inscrire('lea@ex.fr');
  for (const d of ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']) {
    service.declarerSortie(u, { activite: 'course', distanceKm: 0.7, date: d });
    service.enregistrerContrats(d, 28);
  }
  const p = service.projection();
  assert.equal(p.baseJours, 28);
  assert.equal(p.rythmeCourusSemaine, 700);
  assert.equal(p.rythmeDusSemaine, 280);
  assert.equal(p.joursRestants, 28);
  assert.equal(p.ecartProjete, 1680 + 1680);
  assert.equal(p.paliers[0].atteint, true);
  assert.equal(p.paliers[1].dateEstimee, '2026-12-25');
  assert.equal(p.paliers[2].dateEstimee, null);
});
