// Tableau de bord : rafraîchi toutes les heures (les contrats arrivent une fois par jour).
// Accès : utilisateur authentifié, ou ?jeton=DASHBOARD_TOKEN pour un écran d'affichage sans session.
import { api, h, km, kmCourt, kmSigne, pct, anneau, entier } from './commun.js';

const vue = document.getElementById('vue');
const jeton = new URLSearchParams(location.search).get('jeton');

async function rafraichir() {
  try {
    const t = await api(`/api/tableau-de-bord${jeton ? `?jeton=${encodeURIComponent(jeton)}` : ''}`);
    const { courus, dus, ecart, objectif } = t.compteur;
    const i = t.indicateurs;
    const max = Math.max(1, ...t.classement.map((c) => c.metresParPersonne));
    vue.innerHTML = `
      <div class="tb-entete"><h1>Défi 1 contrat = 10 m</h1><span class="sec">Données au ${new Date(t.jour).toLocaleDateString('fr-FR')}</span></div>
      <div class="tb-grille">
        <section class="carte">
          <div class="tb-anneau">
            ${anneau(t.compteur, 260, kmCourt(courus))}
            <div>
              <div class="tb-ecart ${ecart >= 0 ? 'positif' : 'negatif'}">${kmSigne(ecart)}</div>
              <p class="sec">${ecart >= 0 ? 'd’avance' : 'de retard'} · ${km(courus)} courus pour ${km(dus)} dus</p>
              <p class="sec">Objectif saison ${km(objectif)} · ${pct(courus / objectif)} parcourus</p>
            </div>
          </div>
          <h2>Paliers</h2>
          <div class="tb-paliers">${t.paliers.paliers.map((p) => `<div class="tb-palier ${p.atteint ? 'atteint' : ''}">${p.pourcentage} %<div class="sec">${h(p.recompense)}</div></div>`).join('')}</div>
        </section>
        <section class="carte">
          <h2>Couloirs · km par personne</h2>
          ${t.couloirDuMois ? `<p class="sec">Couloir du mois en cours : <strong>${h(t.couloirDuMois.nom)}</strong></p>` : ''}
          <ol class="liste">${t.classement.map((c) => `<li><div class="flex1"><strong>${h(c.nom)}</strong> <span class="sec">${c.participants}/${c.effectif} participants</span>
            <div class="barre"><span data-largeur="${Math.round((c.metresParPersonne / max) * 100)}"></span></div></div>
            <strong>${km(c.metresParPersonne)}</strong></li>`).join('')}</ol>
        </section>
      </div>
      <section class="tb-kpis">
        <div class="carte kpi"><div class="val ${i.ecartPositif ? 'positif' : 'negatif'}">${i.ecartPositif ? 'Oui' : 'Non'}</div><div class="lib">Écart positif (cible au 31/12)</div></div>
        <div class="carte kpi"><div class="val">${pct(i.participationMois.taux)}</div><div class="lib">Participants actifs ce mois (${i.participationMois.actifs}/${i.participationMois.effectif}) · cible 50 %</div></div>
        <div class="carte kpi"><div class="val">${i.couloirsAuSeuil} / 6</div><div class="lib">Couloirs au-delà de 1 km par personne</div></div>
        <div class="carte kpi"><div class="val">${entier(i.inscrits)}</div><div class="lib">Inscrits</div></div>
      </section>`;
    for (const el of vue.querySelectorAll('[data-largeur]')) el.style.width = `${el.dataset.largeur}%`;
  } catch (e) {
    vue.innerHTML = `<div class="message erreur" role="alert">${h(e.message)}</div>`;
  }
}

rafraichir();
setInterval(rafraichir, 60 * 60 * 1000);
