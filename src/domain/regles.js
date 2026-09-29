// Règles de gestion du défi (cahier des charges, section « Règles de gestion »).
// Fonctions pures : aucune I/O, aucune date implicite. Les dates sont des chaînes ISO « AAAA-MM-JJ ».

import { ACTIVITES, COULOIRS } from '../config.js';

// Règle 1 · Mètres dus = contrats cumulés depuis le début de saison × ratio.
export function metresDus(contrats, parametres, jusquau) {
  const { debut } = parametres.saison;
  const total = contrats
    .filter((c) => c.date >= debut && c.date <= jusquau)
    .reduce((s, c) => s + c.nombre, 0);
  return total * parametres.ratioMetresParContrat;
}

export function objectifMetres(parametres) {
  return parametres.contratsAnnuelsPrevus * parametres.ratioMetresParContrat;
}

// Règle 2 · Pondération : course × 1, marche × 1, vélo ÷ 3.
export function metresPonderes(activite, distanceMetres) {
  const a = ACTIVITES[activite];
  if (!a) throw new Error(`Activité inconnue : ${activite}`);
  return Math.round(distanceMetres * a.coefficient);
}

// Règle 5 · Plafond anti-abus par personne et par jour.
// La part au-delà du plafond n'est pas perdue : elle part en validation administrateur.
export function appliquerPlafond(dejaComptesCeJour, ponderes, plafond) {
  const disponible = Math.max(0, plafond - dejaComptesCeJour);
  const comptes = Math.min(ponderes, disponible);
  return { comptes, enAttente: ponderes - comptes };
}

export function metresCourus(sorties) {
  return sorties.reduce((s, x) => s + x.metresComptes, 0);
}

// Règle 4 · Paliers exprimés en pourcentage de l'objectif annuel, mesurés sur les mètres courus.
export function etatPaliers(courus, parametres) {
  const objectif = objectifMetres(parametres);
  const paliers = [...parametres.paliers]
    .sort((a, b) => a.pourcentage - b.pourcentage)
    .map((p) => {
      const seuilMetres = Math.round((objectif * p.pourcentage) / 100);
      return { ...p, seuilMetres, atteint: courus >= seuilMetres, resteMetres: Math.max(0, seuilMetres - courus) };
    });
  return { objectif, paliers, prochain: paliers.find((p) => !p.atteint) ?? null };
}

// Règle 3 · Classement par couloir, en km par personne, jamais par individu.
// Base : l'effectif réel du couloir (annuaire), pas les seuls inscrits. Un couloir
// progresse donc autant en embarquant de nouveaux participants qu'en courant plus.
export function classementCouloirs(sorties, parametres, { depuis, jusquau } = {}) {
  const lignes = COULOIRS.map((c) => {
    const du = sorties.filter(
      (s) => s.couloir === c.id && (!depuis || s.date >= depuis) && (!jusquau || s.date <= jusquau),
    );
    const metres = metresCourus(du);
    const effectif = Math.max(1, parametres.effectifs[c.id] ?? 1);
    const participants = new Set(du.filter((s) => s.userId).map((s) => s.userId)).size;
    const metresParPersonne = Math.round(metres / effectif);
    return {
      couloir: c.id,
      nom: c.nom,
      metres,
      effectif,
      participants,
      metresParPersonne,
      seuilAtteint: metresParPersonne >= parametres.seuilCouloirMetresParPersonne,
    };
  });
  return lignes.sort((a, b) => b.metresParPersonne - a.metresParPersonne || a.nom.localeCompare(b.nom));
}

export function couloirDuMois(sorties, parametres, mois) {
  const [a, m] = mois.split('-').map(Number);
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const classement = classementCouloirs(sorties, parametres, { depuis: `${mois}-01`, jusquau: fin });
  return classement[0].metres > 0 ? classement[0] : null;
}

// Indicateur de pilotage : participants actifs sur le mois / effectif total.
export function tauxParticipationMois(sorties, parametres, mois) {
  const actifs = new Set(sorties.filter((s) => s.userId && s.date.startsWith(mois)).map((s) => s.userId)).size;
  const effectif = Object.values(parametres.effectifs).reduce((s, n) => s + n, 0);
  return { actifs, effectif, taux: effectif ? actifs / effectif : 0 };
}
