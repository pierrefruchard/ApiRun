import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parametresParDefaut } from '../src/config.js';
import {
  appliquerPlafond, classementCouloirs, couloirDuMois, etatPaliers, metresDus, metresPonderes, objectifMetres,
} from '../src/domain/regles.js';

const P = parametresParDefaut();

test('règle 1 · mètres dus = contrats cumulés depuis le 1er janvier × ratio', () => {
  const contrats = [
    { date: '2025-12-31', nombre: 500 },
    { date: '2026-01-02', nombre: 40 },
    { date: '2026-03-10', nombre: 8 },
    { date: '2026-03-11', nombre: 100 },
  ];
  assert.equal(metresDus(contrats, P, '2026-03-10'), 480);
  assert.equal(metresDus(contrats, { ...P, ratioMetresParContrat: 1 }, '2026-03-11'), 148);
});

test('objectif annuel : 20 000 contrats × 10 m = 200 km', () => {
  assert.equal(objectifMetres(P), 200000);
});

test('règle 2 · pondération course × 1, marche × 1, vélo ÷ 3', () => {
  assert.equal(metresPonderes('course', 5000), 5000);
  assert.equal(metresPonderes('marche', 3000), 3000);
  assert.equal(metresPonderes('velo', 30000), 10000);
  assert.throws(() => metresPonderes('natation', 1000));
});

test('règle 5 · plafond de 30 km par jour, excédent en validation', () => {
  assert.deepEqual(appliquerPlafond(0, 12000, 30000), { comptes: 12000, enAttente: 0 });
  assert.deepEqual(appliquerPlafond(25000, 12000, 30000), { comptes: 5000, enAttente: 7000 });
  assert.deepEqual(appliquerPlafond(30000, 4000, 30000), { comptes: 0, enAttente: 4000 });
});

test('règle 4 · paliers à 25, 50, 75 et 100 % de l’objectif', () => {
  const e = etatPaliers(60000, P);
  assert.deepEqual(e.paliers.map((p) => p.seuilMetres), [50000, 100000, 150000, 200000]);
  assert.deepEqual(e.paliers.map((p) => p.atteint), [true, false, false, false]);
  assert.equal(e.prochain.pourcentage, 50);
  assert.equal(e.prochain.resteMetres, 40000);
  assert.equal(etatPaliers(200000, P).prochain, null);
});

test('règle 3 · classement par couloir en km par personne sur l’effectif', () => {
  const sorties = [
    { userId: 'a', couloir: 'crc', date: '2026-05-02', metresComptes: 15000 },
    { userId: 'b', couloir: 'dsi', date: '2026-05-03', metresComptes: 10000 },
    { userId: 'c', couloir: 'dsi', date: '2026-06-03', metresComptes: 10000 },
  ];
  const p = { ...P, effectifs: { ...P.effectifs, crc: 15, dsi: 10 } };
  const c = classementCouloirs(sorties, p);
  assert.equal(c[0].couloir, 'dsi');
  assert.equal(c[0].metresParPersonne, 2000);
  assert.equal(c[0].participants, 2);
  assert.equal(c[0].seuilAtteint, true);
  assert.equal(c[1].couloir, 'crc');
  assert.equal(c[1].metresParPersonne, 1000);
  assert.equal(c.length, 6);
  assert.equal(couloirDuMois(sorties, p, '2026-05').couloir, 'crc');
  assert.equal(couloirDuMois(sorties, p, '2026-02'), null);
});
