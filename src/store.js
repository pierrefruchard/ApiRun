// Persistance : un fichier JSON, écrit de façon atomique.
// Dimensionné pour 90 collaborateurs et une saison : pas de base de données à opérer.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parametresParDefaut } from './config.js';

export function etatInitial() {
  return {
    parametres: parametresParDefaut(),
    annuaire: [],
    utilisateurs: [],
    sorties: [],
    contrats: [],
    fil: [],
    encouragements: [],
    paliersFranchis: [],
    journal: [],
    syncContrats: null,
  };
}

export class Store {
  constructor(chemin) {
    this.chemin = chemin;
    this.etat = etatInitial();
    if (chemin && existsSync(chemin)) {
      const lu = JSON.parse(readFileSync(chemin, 'utf8'));
      this.etat = { ...etatInitial(), ...lu, parametres: { ...parametresParDefaut(), ...lu.parametres } };
    }
  }

  sauver() {
    if (!this.chemin) return;
    mkdirSync(dirname(this.chemin), { recursive: true });
    const tmp = `${this.chemin}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.etat, null, 2));
    renameSync(tmp, this.chemin);
  }

  id() {
    return randomUUID();
  }
}
