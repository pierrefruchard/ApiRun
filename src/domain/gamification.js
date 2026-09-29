// Gamification MVP : série hebdomadaire et badges de régularité.
// Principe : récompenser la régularité et l'entraide, jamais la performance brute.
// Aucun badge ne dépend de la vitesse ni d'une distance maximale.

// Semaine ISO « AAAA-Www » d'une date « AAAA-MM-JJ ».
export function semaineIso(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numero = Math.ceil(((d - debutAnnee) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(numero).padStart(2, '0')}`;
}

function lundiDe(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1));
  return d;
}

function semainePrecedente(date) {
  const d = lundiDe(date);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// Série = semaines consécutives avec au moins une sortie.
// La semaine en cours ne casse pas la série tant qu'elle n'est pas terminée.
// Une série interrompue repart simplement à zéro, sans pénalité.
export function serieHebdomadaire(datesSorties, aujourdhui) {
  const semaines = new Set(datesSorties.map(semaineIso));
  let curseur = aujourdhui;
  if (!semaines.has(semaineIso(curseur))) curseur = semainePrecedente(curseur);
  let courante = 0;
  while (semaines.has(semaineIso(curseur))) {
    courante += 1;
    curseur = semainePrecedente(curseur);
  }

  const triees = [...semaines].sort();
  let record = 0;
  let enCours = 0;
  let precedente = null;
  for (const s of triees) {
    const lundi = lundiDeSemaine(s);
    enCours = precedente && semaineIso(semainePrecedente(lundi)) === precedente ? enCours + 1 : 1;
    record = Math.max(record, enCours);
    precedente = s;
  }
  return { courante, record: Math.max(record, courante), semaineEnCoursFaite: semaines.has(semaineIso(aujourdhui)) };
}

function lundiDeSemaine(semaine) {
  const [annee, w] = semaine.split('-W').map(Number);
  const quatreJanvier = new Date(Date.UTC(annee, 0, 4));
  const lundiS1 = lundiDe(quatreJanvier.toISOString().slice(0, 10));
  lundiS1.setUTCDate(lundiS1.getUTCDate() + (w - 1) * 7);
  return lundiS1.toISOString().slice(0, 10);
}

export const BADGES = [
  { id: 'premiere-sortie', titre: 'Première sortie', description: 'Une première sortie déclarée.' },
  { id: 'quatre-semaines', titre: '4 semaines d’affilée', description: 'Au moins une sortie par semaine, 4 semaines de suite.' },
  { id: 'dix-km', titre: '10 km cumulés', description: '10 km comptés depuis le début du défi.' },
  { id: 'premier-velo', titre: 'Première sortie à vélo', description: 'Une première sortie à vélo.' },
  { id: 'moteur', titre: 'Moteur', description: '20 encouragements donnés.' },
];

export function badgesObtenus({ sorties, encouragementsDonnes, aujourdhui }) {
  const serie = serieHebdomadaire(sorties.map((s) => s.date), aujourdhui);
  const cumul = sorties.reduce((s, x) => s + x.metresComptes, 0);
  const obtenus = new Set();
  if (sorties.length > 0) obtenus.add('premiere-sortie');
  if (serie.record >= 4) obtenus.add('quatre-semaines');
  if (cumul >= 10000) obtenus.add('dix-km');
  if (sorties.some((s) => s.activite === 'velo')) obtenus.add('premier-velo');
  if (encouragementsDonnes >= 20) obtenus.add('moteur');
  return BADGES.map((b) => ({ ...b, obtenu: obtenus.has(b.id) }));
}

// Nom visible dans le fil, selon le choix fait à l'inscription.
export function nomAffiche(utilisateur) {
  if (!utilisateur) return 'Un collègue';
  switch (utilisateur.affichage) {
    case 'prenom':
      return utilisateur.prenom;
    case 'initiales':
      return `${utilisateur.prenom[0] ?? ''}${utilisateur.nom[0] ?? ''}`.toUpperCase();
    default:
      return 'Un collègue';
  }
}
