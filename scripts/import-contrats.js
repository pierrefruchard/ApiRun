// Envoi quotidien des contrats signés vers l'API (à planifier après l'extraction du SI de gestion).
// Entrée : CSV « date;nombre » (un total par jour, aucune donnée client).
// Usage : DEFI_URL=https://defi.intranet INGEST_TOKEN=... node scripts/import-contrats.js extraction.csv
import { readFileSync } from 'node:fs';

const [fichier] = process.argv.slice(2);
const url = process.env.DEFI_URL ?? 'http://localhost:3000';
const jeton = process.env.INGEST_TOKEN;
if (!fichier || !jeton) {
  console.error('Usage : INGEST_TOKEN=... [DEFI_URL=...] node scripts/import-contrats.js fichier.csv');
  process.exit(1);
}

const lignes = readFileSync(fichier, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^\d{4}-\d{2}-\d{2}[;,]\d+$/.test(l))
  .map((l) => {
    const [date, nombre] = l.split(/[;,]/);
    return { date, nombre: Number(nombre) };
  });

const r = await fetch(`${url}/api/ingest/contrats`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
  body: JSON.stringify(lignes),
});
const corps = await r.json();
if (!r.ok) {
  console.error(`Échec ${r.status} : ${corps.erreur}`);
  process.exit(1);
}
console.log(`${lignes.length} jour(s) transmis.`);
