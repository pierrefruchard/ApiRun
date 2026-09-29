// Paramètres par défaut du défi. Tout ce qui est ici est modifiable
// depuis le back-office (persisté dans le store), sauf l'identité des couloirs.

export const COULOIRS = [
  { id: 'crc', nom: 'CRC' },
  { id: 'sante', nom: 'Gestion Santé' },
  { id: 'iard', nom: 'Gestion IARD' },
  { id: 'prevoyance', nom: 'Gestion Prévoyance' },
  { id: 'dsi', nom: 'DSI · RSSI' },
  { id: 'transfo', nom: 'Transformation' },
];

export const ACTIVITES = {
  course: { libelle: 'Course', coefficient: 1 },
  marche: { libelle: 'Marche', coefficient: 1 },
  velo: { libelle: 'Vélo', coefficient: 1 / 3 },
};

export const PROFILS_DEPART = {
  marcheur: { libelle: 'Marcheur', rythmeKmSemaine: 5 },
  joggeur: { libelle: 'Joggeur', rythmeKmSemaine: 10 },
  coureur: { libelle: 'Coureur', rythmeKmSemaine: 20 },
};

export const AFFICHAGES = ['prenom', 'initiales', 'anonyme'];

export function parametresParDefaut() {
  return {
    saison: { debut: '2026-01-01', fin: '2026-12-31' },
    ratioMetresParContrat: 10,
    contratsAnnuelsPrevus: 20000,
    plafondJournalierMetres: 30000,
    seuilCouloirMetresParPersonne: 1000,
    paliers: [
      { pourcentage: 25, recompense: 'À définir (Codir)' },
      { pourcentage: 50, recompense: 'À définir (Codir)' },
      { pourcentage: 75, recompense: 'À définir (Codir)' },
      { pourcentage: 100, recompense: 'À définir (Codir)' },
    ],
    // Effectif réel de chaque couloir (annuaire), base du km par personne.
    effectifs: { crc: 15, sante: 15, iard: 15, prevoyance: 15, dsi: 15, transfo: 15 },
    administrateurs: [],
    referents: {},
  };
}
