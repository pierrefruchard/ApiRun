// Jeu de démonstration : 90 collaborateurs, contrats depuis le 1er janvier, sorties de ~40 inscrits.
// Usage : npm run seed, puis npm run dev.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { COULOIRS } from '../src/config.js';

const chemin = process.env.DATA_FILE ?? fileURLToPath(new URL('../data/defi.json', import.meta.url));
rmSync(chemin, { force: true });
const store = new Store(chemin);
let horloge = new Date();
const service = new Service(store, { maintenant: () => horloge });
const aujourdhui = new Date().toISOString().slice(0, 10);

let graine = 42;
const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);

const PRENOMS = ['Camille', 'Léa', 'Hugo', 'Nora', 'Karim', 'Julie', 'Marc', 'Inès', 'Paul', 'Sofia', 'Yanis', 'Claire', 'Tom', 'Aïcha', 'Luc'];
const NOMS = ['Martin', 'Bernard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Michel', 'Garcia', 'Roux', 'Fournier'];
const annuaire = [];
for (let i = 0; i < 90; i++) {
  const prenom = PRENOMS[i % PRENOMS.length];
  const nom = NOMS[Math.floor(i / PRENOMS.length) % NOMS.length];
  annuaire.push({ email: `${prenom}.${nom}${i}@exemple.fr`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), prenom, nom, couloir: COULOIRS[i % 6].id });
}
service.importerAnnuaire(annuaire);
service.modifierParametres({
  administrateurs: [annuaire[0].email],
  referents: Object.fromEntries(COULOIRS.map((c, i) => [c.id, [annuaire[i].email]])),
});

// Contrats : ~80 par jour ouvré depuis le 1er janvier (≈ 20 000 / an).
for (let d = new Date('2026-01-01T12:00:00Z'); d.toISOString().slice(0, 10) <= aujourdhui; d.setUTCDate(d.getUTCDate() + 1)) {
  const j = d.getUTCDay();
  if (j === 0 || j === 6) continue;
  horloge = new Date(d);
  service.enregistrerContrats(d.toISOString().slice(0, 10), Math.round(60 + alea() * 40));
}

// ~40 inscrits, participation variable selon les couloirs, environ une sortie tous les 25 jours chacun.
const inscrits = annuaire.filter((_, i) => alea() < [0.6, 0.35, 0.4, 0.3, 0.55, 0.7][i % 6]);
const debutSorties = new Date(Date.now() - 56 * 86400000);
horloge = debutSorties;
const utilisateurs = inscrits.map((a, i) =>
  service.inscrire(a.email, { affichage: ['prenom', 'initiales', 'anonyme'][i % 3], consentementRgpd: true, profil: ['marcheur', 'joggeur', 'coureur'][i % 3] }),
);
for (let d = new Date(debutSorties); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
  horloge = new Date(d);
  for (const [i, u] of utilisateurs.entries()) {
    if (alea() > 0.04) continue;
    const activite = alea() < 0.15 ? 'velo' : ['marche', 'course', 'course'][i % 3];
    const distanceKm = Math.round((activite === 'velo' ? 15 + alea() * 30 : activite === 'marche' ? 2 + alea() * 5 : 4 + alea() * 8) * 10) / 10;
    const s = service.declarerSortie(u, { activite, distanceKm, date: d.toISOString().slice(0, 10) });
    if (alea() < 0.5) {
      const autre = utilisateurs[Math.floor(alea() * utilisateurs.length)];
      if (autre.id !== u.id) service.encourager(autre, s.id);
    }
  }
}
horloge = new Date();
service.declarerSortie(utilisateurs[1], { activite: 'velo', distanceKm: 120, date: aujourdhui });

console.log(`Démo prête : ${annuaire.length} collaborateurs, ${utilisateurs.length} inscrits, ${store.etat.sorties.length} sorties.`);
console.log(`Administrateur : ${annuaire[0].email}`);
