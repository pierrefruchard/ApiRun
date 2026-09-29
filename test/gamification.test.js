import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgesObtenus, nomAffiche, semaineIso, serieHebdomadaire } from '../src/domain/gamification.js';

test('semaine ISO', () => {
  assert.equal(semaineIso('2026-01-01'), '2026-W01');
  assert.equal(semaineIso('2026-09-29'), '2026-W40');
  assert.equal(semaineIso('2027-01-01'), '2026-W53');
});

test('série hebdomadaire : la semaine en cours ne casse pas la série', () => {
  // Mardi 29/09 (W40). Sorties en W37, W38, W39, rien encore en W40.
  const dates = ['2026-09-08', '2026-09-15', '2026-09-22'];
  const s = serieHebdomadaire(dates, '2026-09-29');
  assert.equal(s.courante, 3);
  assert.equal(s.semaineEnCoursFaite, false);
  assert.equal(serieHebdomadaire([...dates, '2026-09-29'], '2026-09-29').courante, 4);
});

test('série interrompue : repart à zéro, le record est conservé', () => {
  const dates = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-09-22'];
  const s = serieHebdomadaire(dates, '2026-10-06');
  assert.equal(s.courante, 0);
  assert.equal(s.record, 4);
});

test('série à cheval sur deux années', () => {
  assert.equal(serieHebdomadaire(['2026-12-21', '2026-12-28', '2027-01-04'], '2027-01-05').record, 3);
});

test('badges de régularité, jamais de performance', () => {
  const sorties = [
    { date: '2026-09-01', activite: 'marche', metresComptes: 4000 },
    { date: '2026-09-08', activite: 'velo', metresComptes: 3000 },
    { date: '2026-09-15', activite: 'marche', metresComptes: 2000 },
    { date: '2026-09-22', activite: 'course', metresComptes: 1500 },
  ];
  const b = Object.fromEntries(badgesObtenus({ sorties, encouragementsDonnes: 20, aujourdhui: '2026-09-29' }).map((x) => [x.id, x.obtenu]));
  assert.deepEqual(b, { 'premiere-sortie': true, 'quatre-semaines': true, 'dix-km': true, 'premier-velo': true, moteur: true });
  const vide = badgesObtenus({ sorties: [], encouragementsDonnes: 19, aujourdhui: '2026-09-29' });
  assert.ok(vide.every((x) => !x.obtenu));
});

test('affichage dans le fil : prénom, initiales ou anonyme', () => {
  const u = { prenom: 'Léa', nom: 'Martin' };
  assert.equal(nomAffiche({ ...u, affichage: 'prenom' }), 'Léa');
  assert.equal(nomAffiche({ ...u, affichage: 'initiales' }), 'LM');
  assert.equal(nomAffiche({ ...u, affichage: 'anonyme' }), 'Un collègue');
  assert.equal(nomAffiche(null), 'Un collègue');
});
