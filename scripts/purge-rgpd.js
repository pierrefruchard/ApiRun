// Purge RGPD : suppression des données personnelles 3 mois après la fin de saison.
// À planifier quotidiennement ; sans effet avant l'échéance.
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';

const store = new Store(process.env.DATA_FILE ?? fileURLToPath(new URL('../data/defi.json', import.meta.url)));
const r = new Service(store).purgeRgpd();
console.log(r.purge ? `Purge effectuée (échéance ${r.echeance}).` : `Rien à purger avant le ${r.echeance}.`);
