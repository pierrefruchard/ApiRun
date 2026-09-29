// Utilitaires partagés par l'app mobile, le tableau de bord et le back-office.

export async function api(chemin, { methode = 'GET', corps } = {}) {
  const r = await fetch(chemin, {
    method: methode,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'defi' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    credentials: 'same-origin',
  });
  const type = r.headers.get('content-type') ?? '';
  const donnees = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const e = new Error(donnees?.erreur ?? `Erreur ${r.status}`);
    e.statut = r.status;
    throw e;
  }
  return donnees;
}

const ECHAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ECHAP[c]);

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const kmCourt = (metres) => `${nf0.format(metres / 1000)} km`;
export const km = (metres) => `${nf1.format(metres / 1000)} km`;
export const kmSigne = (metres) => `${metres >= 0 ? '+' : '−'}${nf1.format(Math.abs(metres) / 1000)} km`;
export const m = (metres) => `${nf0.format(metres)} m`;
export const entier = (n) => nf0.format(n);
export const pct = (x) => `${nf0.format(x * 100)} %`;

// Anneau : arc plein = mètres courus, repère = mètres dus, tous deux rapportés à l'objectif annuel.
// Au-delà de l'objectif, l'arc reste plein : l'écart chiffré porte l'information.
export function anneau({ courus, dus, objectif }, taille = 140, centre = '') {
  const r = 58;
  const c = 2 * Math.PI * r;
  const fc = Math.min(1, courus / objectif);
  const fd = Math.min(1, dus / objectif);
  const angle = fd * 2 * Math.PI - Math.PI / 2;
  const x1 = 70 + (r - 10) * Math.cos(angle);
  const y1 = 70 + (r - 10) * Math.sin(angle);
  const x2 = 70 + (r + 10) * Math.cos(angle);
  const y2 = 70 + (r + 10) * Math.sin(angle);
  return `<svg viewBox="0 0 140 140" width="${taille}" height="${taille}" role="img"
      aria-label="Mètres courus ${km(courus)} pour ${km(dus)} dus, objectif ${km(objectif)}">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--anneau-fond)" stroke-width="14"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${fc * c} ${c}" transform="rotate(-90 70 70)"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--texte)" stroke-width="3"/>
    <text x="70" y="75" text-anchor="middle" fill="var(--texte)" font-size="15" font-weight="700">${h(centre)}</text>
  </svg>`;
}

// « 1 mètre », « 10 mètres »
export const metresParContrat = (ratio) => `${String(ratio).replace('.', ',')} mètre${ratio >= 2 ? 's' : ''}`;

export function dateCourte(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
