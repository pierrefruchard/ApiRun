// Back-office : pilotage, collaborateurs, file hors plafond, contrats, paramètres, journal.
// Objectif d'exploitation : moins d'une heure d'administration par semaine.
import { api, h, km, kmSigne, m, entier, pct } from './commun.js';

const vue = document.getElementById('vue');
let config;
let session;

const ONGLETS = [
  ['pilotage', 'Pilotage'],
  ['collaborateurs', 'Collaborateurs'],
  ['hors-plafond', 'Hors plafond'],
  ['contrats', 'Contrats'],
  ['parametres', 'Paramètres'],
  ['journal', 'Journal'],
];

const nomCouloir = (id) => config.couloirs.find((c) => c.id === id)?.nom ?? id;
const dateFr = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('fr-FR') : '–');
const dateHeureFr = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const optionsCouloirs = (sel) => config.couloirs.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${h(c.nom)}</option>`).join('');
const msgErreur = (e) => `<div class="message erreur" role="alert">${h(e.message)}</div>`;

function cadre(actif, contenu) {
  vue.innerHTML = `
    <div class="adm-entete">
      <h1>Back-office du défi</h1>
      <div class="actions"><a class="bouton" href="/">App</a><a class="bouton" href="/tableau.html">Tableau de bord</a></div>
    </div>
    <nav class="adm-onglets" aria-label="Sections du back-office">
      ${ONGLETS.map(([k, l]) => `<a href="#${k}" ${k === actif ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
    </nav>
    <div id="contenu">${contenu}</div>`;
  for (const el of vue.querySelectorAll('[data-largeur]')) el.style.width = `${el.dataset.largeur}%`;
}

// ================= Pilotage =================

function pasArrondi(max) {
  const brut = max / 4;
  const p = 10 ** Math.floor(Math.log10(brut || 1));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= brut) ?? brut;
}

// Cumul des mètres courus vs dus, semaine par semaine. Une seule échelle, deux séries.
// La largeur du repère suit celle de l'écran : le texte garde sa taille réelle sur mobile.
function grapheCumul(evolution) {
  const L = Math.max(320, Math.min(1100, vue.clientWidth - 40));
  const H = L < 600 ? 240 : 280;
  const mg = { g: 56, d: 124, h: 16, b: 32 };
  const n = evolution.length;
  const max = Math.max(1000, ...evolution.map((w) => Math.max(w.cumulCourus, w.cumulDus)));
  const pas = pasArrondi(max);
  const haut = Math.ceil(max / pas) * pas;
  const x = (i) => mg.g + (n <= 1 ? 0 : (i / (n - 1)) * (L - mg.g - mg.d));
  const y = (v) => H - mg.b - (v / haut) * (H - mg.h - mg.b);
  const trace = (cle) => evolution.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w[cle]).toFixed(1)}`).join(' ');
  const graduations = [];
  for (let v = 0; v <= haut; v += pas) {
    graduations.push(`<line class="grille" x1="${mg.g}" x2="${L - mg.d}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axe" x="${mg.g - 8}" y="${y(v) + 4}" text-anchor="end">${h(km(v).replace(',0', ''))}</text>`);
  }
  const rythme = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(L / 100))));
  const abscisses = evolution
    .map((w, i) => (i % rythme === 0 || i === n - 1 ? `<text class="axe" x="${x(i)}" y="${H - 10}" text-anchor="middle">${h(w.semaine.slice(5))}</text>` : ''))
    .join('');
  const der = evolution.at(-1);
  let yc = y(der.cumulCourus);
  let yd = y(der.cumulDus);
  if (Math.abs(yc - yd) < 16) {
    const milieu = (yc + yd) / 2;
    const signe = yc <= yd ? -1 : 1;
    yc = milieu + signe * 8;
    yd = milieu - signe * 8;
  }
  return `
    <div class="legende"><span>Mètres courus (cumul)</span><span class="l-dus">Mètres dus (cumul)</span></div>
    <div class="graphe" id="graphe">
      <svg viewBox="0 0 ${L} ${H}" role="img" tabindex="0"
        aria-label="Cumul hebdomadaire : ${h(km(der.cumulCourus))} courus pour ${h(km(der.cumulDus))} dus. Détail dans le tableau ci-dessous. Flèches gauche et droite pour parcourir les semaines.">
        ${graduations.join('')}
        ${abscisses}
        <path class="dus" d="${trace('cumulDus')}"/>
        <path class="courus" d="${trace('cumulCourus')}"/>
        <text class="etiq" x="${x(n - 1) + 8}" y="${yc + 4}">${h(km(der.cumulCourus))} courus</text>
        <text class="etiq" x="${x(n - 1) + 8}" y="${yd + 4}">${h(km(der.cumulDus))} dus</text>
        <line class="viseur cache" id="viseur" y1="${mg.h}" y2="${H - mg.b}"/>
        <rect id="zone" x="${mg.g}" y="${mg.h}" width="${L - mg.g - mg.d}" height="${H - mg.h - mg.b}" fill="transparent"/>
      </svg>
      <div class="infobulle cache" id="bulle" role="status"></div>
    </div>`;
}

function activerGraphe(evolution) {
  const conteneur = document.getElementById('graphe');
  if (!conteneur) return;
  const svg = conteneur.querySelector('svg');
  const zone = document.getElementById('zone');
  const viseur = document.getElementById('viseur');
  const bulle = document.getElementById('bulle');
  const n = evolution.length;
  const x0 = Number(zone.getAttribute('x'));
  const largeur = Number(zone.getAttribute('width'));
  let courant = n - 1;

  const montrer = (i) => {
    courant = Math.max(0, Math.min(n - 1, i));
    const w = evolution[courant];
    const xs = x0 + (n <= 1 ? 0 : (courant / (n - 1)) * largeur);
    viseur.setAttribute('x1', xs);
    viseur.setAttribute('x2', xs);
    viseur.classList.remove('cache');
    bulle.replaceChildren();
    const titre = document.createElement('div');
    titre.textContent = `Semaine ${w.semaine.slice(6)} · du ${dateFr(w.debut)}`;
    titre.className = 'sec';
    bulle.append(titre);
    for (const [cle, lib, cls] of [['cumulCourus', 'courus', ''], ['cumulDus', 'dus', 'dus']]) {
      const ligne = document.createElement('div');
      const k = document.createElement('span');
      k.className = `cle ${cls}`;
      const v = document.createElement('strong');
      v.textContent = km(w[cle]);
      ligne.append(k, v, document.createTextNode(` ${lib}`));
      bulle.append(ligne);
    }
    const ecart = document.createElement('div');
    ecart.textContent = `Écart ${kmSigne(w.ecart)}`;
    bulle.append(ecart);
    const r = svg.getBoundingClientRect();
    const px = (xs / svg.viewBox.baseVal.width) * r.width;
    bulle.classList.remove('cache');
    bulle.style.top = '8px';
    // L'infobulle passe à gauche du viseur dans la moitié droite, pour ne pas masquer les étiquettes de fin.
    bulle.style.left = `${px > r.width / 2 ? Math.max(4, px - bulle.offsetWidth - 12) : px + 12}px`;
  };
  const cacher = () => {
    viseur.classList.add('cache');
    bulle.classList.add('cache');
  };
  svg.addEventListener('pointermove', (ev) => {
    const r = svg.getBoundingClientRect();
    const xv = ((ev.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    montrer(Math.round(((xv - x0) / largeur) * (n - 1)));
  });
  svg.addEventListener('pointerleave', cacher);
  svg.addEventListener('focus', () => montrer(courant));
  svg.addEventListener('blur', cacher);
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') montrer(courant - 1);
    if (ev.key === 'ArrowRight') montrer(courant + 1);
  });
}

async function ongletPilotage() {
  const p = await api('/api/admin/pilotage');
  const t = p.tableau;
  const i = t.indicateurs;
  const pr = p.projection;
  const prochain = pr.disponible ? pr.paliers.find((x) => !x.atteint) : null;
  const kpi = (val, lib, cls = '') => `<section class="carte kpi"><div class="val ${cls}">${val}</div><div class="lib">${lib}</div></section>`;

  const kpis = [
    kpi(kmSigne(t.compteur.ecart), `Écart actuel · ${km(t.compteur.courus)} courus, ${km(t.compteur.dus)} dus`, t.compteur.ecart >= 0 ? 'positif' : 'negatif'),
    pr.disponible
      ? kpi(kmSigne(pr.ecartProjete), `Écart projeté au 31/12 · rythme des ${pr.baseJours} derniers jours`, pr.ecartProjete >= 0 ? 'positif' : 'negatif')
      : kpi('–', h(pr.raison)),
    kpi(prochain ? `${prochain.pourcentage} %` : 'Tous', prochain ? (prochain.dateEstimee ? `Prochain palier, estimé le ${dateFr(prochain.dateEstimee)}` : 'Prochain palier, pas atteint à ce rythme') : 'Paliers franchis'),
    kpi(pct(i.participationMois.taux), `Actifs ce mois · ${i.participationMois.actifs}/${i.participationMois.effectif}, cible 50 %`),
    kpi(entier(i.inscrits), 'Inscrits'),
    kpi(`<a href="#hors-plafond">${p.fileHorsPlafond}</a>`, 'Déclarations hors plafond à traiter', p.fileHorsPlafond ? 'negatif' : ''),
  ].join('');

  const semaines = [...p.evolution].reverse().slice(0, 12);
  const tableEvolution = `
    <div class="defile"><table class="dense">
      <thead><tr><th>Semaine</th><th class="num">Courus</th><th class="num">Dus</th><th class="num">Écart cumulé</th><th class="num">Sorties</th><th class="num">Actifs</th><th class="num">Nouveaux inscrits</th></tr></thead>
      <tbody>${semaines.map((w) => `<tr><td>${h(w.semaine)} <span class="sec">${dateFr(w.debut)}</span></td>
        <td class="num">${km(w.courus)}</td><td class="num">${km(w.dus)}</td>
        <td class="num ${w.ecart >= 0 ? 'positif' : 'negatif'}">${kmSigne(w.ecart)}</td>
        <td class="num">${w.sorties}</td><td class="num">${w.actifs}</td><td class="num">${w.nouveauxInscrits}</td></tr>`).join('')}</tbody>
    </table></div>`;

  const attrition = `
    <div class="defile"><table class="dense">
      <thead><tr><th>Couloir</th><th class="num">Inscrits</th><th class="num">Actifs 14 j</th><th class="num">Inactifs 14 j</th><th class="num">Jamais sortis</th></tr></thead>
      <tbody>${p.attrition.map((c) => `<tr><td>${h(c.nom)}</td><td class="num">${c.inscrits}</td><td class="num">${c.actifs14j}</td>
        <td class="num">${c.inactifs14j ? `<span class="pastille alerte">${c.inactifs14j}</span>` : 0}</td>
        <td class="num">${c.jamaisSortis ? `<span class="pastille alerte">${c.jamaisSortis}</span>` : 0}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="sec">Agrégé par couloir, sans nom : à relayer aux référents pour cibler l'animation.</p>`;

  const projection = pr.disponible
    ? `<p class="sec">Rythme hebdomadaire : ${km(pr.rythmeCourusSemaine)} courus, ${km(pr.rythmeDusSemaine)} dus. ${pr.joursRestants} jours restants.</p>
       <ul class="liste">${pr.paliers.map((x) => `<li><span>Palier ${x.pourcentage} %</span><span>${x.atteint ? '<span class="pastille ok">Franchi</span>' : x.dateEstimee ? dateFr(x.dateEstimee) : '<span class="pastille alerte">Hors saison à ce rythme</span>'}</span></li>`).join('')}</ul>`
    : `<p class="sec">${h(pr.raison)}</p>`;

  cadre('pilotage', `
    <div class="adm-kpis">${kpis}</div>
    <section class="carte"><h2>Mètres courus vs mètres dus, cumul par semaine</h2>${p.evolution.length ? grapheCumul(p.evolution) : '<p class="sec">La saison n’a pas commencé.</p>'}</section>
    <div class="adm-deux">
      <section class="carte"><h2>Évolution hebdomadaire</h2>${tableEvolution}</section>
      <div>
        <section class="carte"><h2>Projection fin de saison</h2>${projection}</section>
        <section class="carte"><h2>Signaux d’attrition</h2>${attrition}</section>
      </div>
    </div>`);
  activerGraphe(p.evolution);
}

// ================= Collaborateurs =================

let filtres = { texte: '', couloir: '', statut: '' };

async function ongletCollaborateurs() {
  const liste = await api('/api/admin/collaborateurs');
  const statut = (u) => (!u.derniereSortie ? 'jamais' : u.inactif14j ? 'inactif' : 'actif');
  const pastille = { actif: '<span class="pastille ok">Actif</span>', inactif: '<span class="pastille alerte">Inactif 14 j</span>', jamais: '<span class="pastille">Jamais sorti</span>' };

  const rendreTable = () => {
    const t = filtres.texte.trim().toLowerCase();
    const visibles = liste.filter((u) =>
      (!t || `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(t)) &&
      (!filtres.couloir || u.couloir === filtres.couloir) &&
      (!filtres.statut || statut(u) === filtres.statut));
    document.getElementById('tbl').innerHTML = visibles.length
      ? visibles.map((u) => `<tr class="cliquable" data-id="${h(u.id)}" tabindex="0">
          <td><strong>${h(u.nom)}</strong> ${h(u.prenom)}<div class="sec">${h(u.email)}</div></td>
          <td>${h(nomCouloir(u.couloir))}</td><td>${dateFr(u.inscritLe)}</td>
          <td class="num">${u.sorties}</td><td class="num">${km(u.metres)}</td><td>${dateFr(u.derniereSortie)}</td><td>${pastille[statut(u)]}</td></tr>`).join('')
      : '<tr><td colspan="7" class="sec">Aucun collaborateur ne correspond.</td></tr>';
    document.getElementById('compte').textContent = `${visibles.length} / ${liste.length}`;
    for (const tr of vue.querySelectorAll('tr[data-id]')) {
      const ouvrir = () => (location.hash = `#collaborateurs/${tr.dataset.id}`);
      tr.onclick = ouvrir;
      tr.onkeydown = (e) => e.key === 'Enter' && ouvrir();
    }
  };

  cadre('collaborateurs', `
    <section class="carte">
      <div class="filtres">
        <div><label for="f-texte">Rechercher</label><input id="f-texte" type="search" placeholder="Nom, prénom ou email" value="${h(filtres.texte)}"></div>
        <div><label for="f-couloir">Couloir</label><select id="f-couloir"><option value="">Tous</option>${optionsCouloirs(filtres.couloir)}</select></div>
        <div><label for="f-statut">Statut</label><select id="f-statut">
          ${[['', 'Tous'], ['actif', 'Actifs 14 j'], ['inactif', 'Inactifs 14 j'], ['jamais', 'Jamais sortis']].map(([v, l]) => `<option value="${v}" ${v === filtres.statut ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      </div>
      <p class="sec"><span id="compte"></span> inscrits · ouvrir une fiche est tracé dans le journal.</p>
      <div class="defile"><table class="dense">
        <thead><tr><th>Collaborateur</th><th>Couloir</th><th>Inscrit le</th><th class="num">Sorties</th><th class="num">Comptés</th><th>Dernière sortie</th><th>Statut</th></tr></thead>
        <tbody id="tbl"></tbody>
      </table></div>
    </section>`);
  for (const [id, cle] of [['f-texte', 'texte'], ['f-couloir', 'couloir'], ['f-statut', 'statut']]) {
    document.getElementById(id).oninput = (e) => {
      filtres[cle] = e.target.value;
      rendreTable();
    };
  }
  rendreTable();
}

async function ficheCollaborateur(id) {
  const f = await api(`/api/admin/collaborateurs/${encodeURIComponent(id)}`);
  const optActivites = (sel) => Object.entries(config.activites).map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${h(a.libelle)}</option>`).join('');
  const ligne = (s) => `<tr data-sortie="${h(s.id)}">
      <td>${dateFr(s.date)}</td><td>${h(config.activites[s.activite].libelle)}</td>
      <td class="num">${km(s.distanceMetres)}</td><td class="num">${km(s.metresComptes)}</td>
      <td>${s.statutPlafond === 'en_attente' ? `<span class="pastille alerte">${m(s.metresEnAttente)} en attente</span>` : s.statutPlafond === 'refuse' ? '<span class="pastille">Excédent refusé</span>' : ''}</td>
      <td><div class="actions"><button data-corriger="${h(s.id)}">Corriger</button><button class="danger" data-supprimer="${h(s.id)}">Supprimer</button></div></td></tr>`;

  cadre('collaborateurs', `
    <p><a class="bouton" href="#collaborateurs">← Liste</a></p>
    <section class="carte fiche">
      <h2>${h(f.prenom)} ${h(f.nom)}</h2>
      <p class="sec">${h(f.email)} · inscrit le ${dateFr(f.inscritLe)} · affichage « ${h(f.affichage)} »${f.profil ? ` · profil ${h(f.profil)}` : ''}</p>
      <p class="sec">Badges : ${f.badges.length ? f.badges.map(h).join(', ') : 'aucun'}</p>
      <div class="filtres">
        <div><label for="couloir">Couloir</label><select id="couloir">${optionsCouloirs(f.couloir)}</select></div>
      </div>
      <div id="msg"></div>
    </section>
    <section class="carte">
      <h2>Sorties (${f.sorties.length})</h2>
      <div class="defile"><table class="dense">
        <thead><tr><th>Date</th><th>Activité</th><th class="num">Distance</th><th class="num">Comptés</th><th>Plafond</th><th></th></tr></thead>
        <tbody>${f.sorties.map(ligne).join('') || '<tr><td colspan="6" class="sec">Aucune sortie.</td></tr>'}</tbody>
      </table></div>
    </section>
    <section class="carte">
      <h2>Désinscrire</h2>
      <p class="sec">Pour un départ de l’entreprise. Données personnelles supprimées immédiatement, mètres conservés au compteur, anonymisés.</p>
      <button class="danger" id="desinscrire">Désinscrire ${h(f.prenom)} ${h(f.nom)}</button>
    </section>`);

  const msg = document.getElementById('msg');
  document.getElementById('couloir').onchange = async (e) => {
    try {
      await api(`/api/admin/collaborateurs/${encodeURIComponent(id)}/couloir`, { methode: 'POST', corps: { couloir: e.target.value } });
      msg.innerHTML = '<div class="message ok">Couloir modifié.</div>';
    } catch (err) {
      msg.innerHTML = msgErreur(err);
    }
  };
  for (const b of vue.querySelectorAll('[data-supprimer]')) {
    b.onclick = async () => {
      if (!confirm('Supprimer cette sortie du compteur ? Action tracée dans le journal.')) return;
      await api(`/api/admin/sorties/${b.dataset.supprimer}`, { methode: 'DELETE' });
      ficheCollaborateur(id);
    };
  }
  for (const b of vue.querySelectorAll('[data-corriger]')) {
    b.onclick = () => {
      const s = f.sorties.find((x) => x.id === b.dataset.corriger);
      const tr = b.closest('tr');
      tr.innerHTML = `
        <td><input type="date" id="c-date" value="${s.date}" aria-label="Date"></td>
        <td><select id="c-act" aria-label="Activité">${optActivites(s.activite)}</select></td>
        <td><input type="number" id="c-km" step="0.1" min="0.1" value="${s.distanceMetres / 1000}" aria-label="Distance en km"></td>
        <td colspan="2" class="sec">Recalcul et plafond appliqués à l’enregistrement.</td>
        <td><div class="actions"><button class="primaire" id="c-ok">Enregistrer</button><button id="c-annuler">Annuler</button></div></td>`;
      document.getElementById('c-annuler').onclick = () => ficheCollaborateur(id);
      document.getElementById('c-ok').onclick = async () => {
        try {
          await api(`/api/admin/sorties/${s.id}`, {
            methode: 'PATCH',
            corps: { date: document.getElementById('c-date').value, activite: document.getElementById('c-act').value, distanceKm: Number(document.getElementById('c-km').value) },
          });
          ficheCollaborateur(id);
        } catch (err) {
          msg.innerHTML = msgErreur(err);
        }
      };
    };
  }
  document.getElementById('desinscrire').onclick = async () => {
    if (!confirm(`Désinscrire ${f.prenom} ${f.nom} et supprimer ses données personnelles ? Action irréversible.`)) return;
    await api(`/api/admin/collaborateurs/${encodeURIComponent(id)}`, { methode: 'DELETE' });
    location.hash = '#collaborateurs';
  };
}

// ================= Hors plafond =================

async function ongletHorsPlafond() {
  const file = await api('/api/admin/hors-plafond');
  cadre('hors-plafond', `
    <section class="carte">
      <h2>Déclarations au-delà de ${km(config.plafondJournalierMetres)} par jour (${file.length})</h2>
      <p class="sec">La part sous le plafond est déjà comptée. Valider ajoute l’excédent au compteur, refuser l’écarte.</p>
      ${file.length ? `<div class="defile"><table class="dense"><thead><tr><th>Date</th><th>Collaborateur</th><th>Activité</th><th class="num">Distance</th><th class="num">Comptés</th><th class="num">En attente</th><th></th></tr></thead><tbody>
        ${file.map((s) => `<tr><td>${dateFr(s.date)}</td><td>${s.userId ? `<a href="#collaborateurs/${h(s.userId)}">${h(s.collaborateur)}</a>` : h(s.collaborateur)}</td>
          <td>${h(config.activites[s.activite].libelle)}</td><td class="num">${km(s.distanceMetres)}</td><td class="num">${km(s.metresComptes)}</td><td class="num">${km(s.metresEnAttente)}</td>
          <td><div class="actions"><button class="primaire" data-dec="valider" data-id="${h(s.id)}">Valider</button><button data-dec="refuser" data-id="${h(s.id)}">Refuser</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<p>Aucune déclaration en attente.</p>'}
    </section>`);
  for (const b of vue.querySelectorAll('[data-dec]')) {
    b.onclick = async () => {
      await api(`/api/admin/hors-plafond/${b.dataset.id}`, { methode: 'POST', corps: { decision: b.dataset.dec } });
      ongletHorsPlafond();
    };
  }
}

// ================= Contrats =================

async function ongletContrats() {
  const c = await api('/api/admin/contrats');
  const s = c.synchro;
  const ratio = config.ratioMetresParContrat;
  const etat = !c.connecteurConfigure
    ? '<p><span class="pastille alerte">Connecteur non configuré</span> Renseigner SI_API_URL et SI_API_KEY sur le serveur.</p>'
    : !s
      ? '<p><span class="pastille">Jamais synchronisé</span></p>'
      : `<p>${s.erreur ? `<span class="pastille alerte">Échec</span> ${h(s.erreur)}` : '<span class="pastille ok">OK</span>'}</p>
         <p class="sec">Dernière tentative ${dateHeureFr(s.derniereTentative)} · dernier succès ${s.dernierSucces ? dateHeureFr(s.dernierSucces) : 'aucun'} · ${s.joursMisAJour} jour(s) mis à jour</p>`;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  cadre('contrats', `
    <div class="adm-deux">
      <section class="carte">
        <h2>Derniers jours</h2>
        <div class="defile"><table class="dense"><thead><tr><th>Date</th><th class="num">Contrats</th><th class="num">Mètres dus</th></tr></thead><tbody>
          ${c.jours.slice(0, 30).map((j) => `<tr><td>${dateFr(j.date)}</td><td class="num">${entier(j.nombre)}</td><td class="num">${m(j.nombre * ratio)}</td></tr>`).join('') || '<tr><td colspan="3" class="sec">Aucun contrat enregistré.</td></tr>'}
        </tbody></table></div>
      </section>
      <div>
        <section class="carte">
          <h2>Synchronisation API du SI</h2>
          <p class="sec">Chaque jour, l’app lit le total de la veille et reprend les 7 derniers jours pour absorber les régularisations.</p>
          ${etat}
          <button class="primaire" id="sync" ${c.connecteurConfigure ? '' : 'disabled'}>Synchroniser maintenant</button>
          <div id="sync-msg"></div>
        </section>
        <section class="carte">
          <h2>Saisie de secours</h2>
          <p class="sec">Total des contrats signés sur la journée. Remplace la valeur existante.</p>
          <div class="grille">
            <div><label for="c-date">Date</label><input id="c-date" type="date" value="${aujourdhui}" max="${aujourdhui}"></div>
            <div><label for="c-nb">Contrats</label><input id="c-nb" type="number" min="0" step="1"></div>
          </div>
          <p></p><button id="c-ok">Enregistrer</button><div id="c-msg"></div>
        </section>
      </div>
    </div>`);
  document.getElementById('sync').onclick = async (e) => {
    e.target.disabled = true;
    try {
      await api('/api/admin/contrats/synchroniser', { methode: 'POST', corps: {} });
      ongletContrats();
    } catch (err) {
      document.getElementById('sync-msg').innerHTML = msgErreur(err);
      e.target.disabled = false;
    }
  };
  document.getElementById('c-ok').onclick = async () => {
    try {
      await api('/api/admin/contrats', { methode: 'POST', corps: { date: document.getElementById('c-date').value, nombre: Number(document.getElementById('c-nb').value) } });
      ongletContrats();
    } catch (err) {
      document.getElementById('c-msg').innerHTML = msgErreur(err);
    }
  };
}

// ================= Paramètres =================

async function ongletParametres() {
  const p = await api('/api/admin/parametres');
  const [titulaire = '', ...suppleants] = p.administrateurs;
  cadre('parametres', `
    <section class="carte">
      <h2>Saison et calcul</h2>
      <div class="grille">
        <div><label for="p-debut">Début de saison</label><input id="p-debut" type="date" value="${p.saison.debut}"></div>
        <div><label for="p-fin">Fin de saison</label><input id="p-fin" type="date" value="${p.saison.fin}"></div>
        <div><label for="p-ratio">Mètres par contrat</label><input id="p-ratio" type="number" min="0.1" step="0.1" value="${p.ratioMetresParContrat}"></div>
        <div><label for="p-vol">Contrats prévus sur la saison</label><input id="p-vol" type="number" min="1" value="${p.contratsAnnuelsPrevus}"></div>
        <div><label for="p-plafond">Plafond / pers. / jour (m)</label><input id="p-plafond" type="number" min="1000" step="1000" value="${p.plafondJournalierMetres}"></div>
        <div class="kpi"><div class="lib">Objectif résultant</div><div class="val" id="objectif"></div></div>
      </div>
    </section>
    <section class="carte">
      <h2>Paliers</h2>
      <p class="sec">Récompense vide : palier symbolique, annoncé dans le fil sans lot.</p>
      ${p.paliers.map((x, i) => `<div class="grille"><div><label for="pl-${i}">Palier (%)</label><input id="pl-${i}" type="number" min="1" max="100" value="${x.pourcentage}"></div>
        <div><label for="rc-${i}">Récompense</label><input id="rc-${i}" value="${h(x.recompense)}" placeholder="Symbolique"></div></div>`).join('')}
    </section>
    <section class="carte">
      <h2>Couloirs : effectifs et référents</h2>
      <p class="sec">L’effectif réel sert de base au km par personne.</p>
      ${config.couloirs.map((c) => `<div class="grille"><div><label for="ef-${c.id}">${h(c.nom)} · effectif</label><input id="ef-${c.id}" type="number" min="0" value="${p.effectifs[c.id] ?? 0}"></div>
        <div><label for="rf-${c.id}">Référents (emails, virgules)</label><input id="rf-${c.id}" value="${h((p.referents[c.id] ?? []).join(', '))}"></div></div>`).join('')}
    </section>
    <section class="carte">
      <h2>Administrateurs</h2>
      <div class="grille">
        <div><label for="adm-t">Titulaire</label><input id="adm-t" type="email" value="${h(titulaire)}"></div>
        <div><label for="adm-s">Suppléant</label><input id="adm-s" type="email" value="${h(suppleants.join(', '))}"></div>
      </div>
    </section>
    <p><button class="primaire" id="p-ok">Enregistrer les paramètres</button></p><div id="p-msg"></div>
    <section class="carte">
      <h2>Annuaire</h2>
      <p class="sec">Une ligne par collaborateur : email;prénom;nom;couloir (${config.couloirs.map((c) => c.id).join(', ')}). L’import renvoie les personnes à inviter.</p>
      <textarea id="an" rows="5" class="pleine" aria-label="Lignes d’annuaire"></textarea>
      <p></p><button id="an-ok">Importer</button><div id="an-msg"></div>
    </section>
    <section class="carte">
      <h2>Export</h2>
      <p class="sec">Sorties sans donnée nominative (date, couloir, activité, distances). Export tracé.</p>
      <a class="bouton" href="/api/admin/export.csv">Télécharger le CSV</a>
    </section>`);

  const val = (id) => document.getElementById(id).value;
  const majObjectif = () => {
    document.getElementById('objectif').textContent = km(Number(val('p-ratio')) * Number(val('p-vol')));
  };
  document.getElementById('p-ratio').oninput = majObjectif;
  document.getElementById('p-vol').oninput = majObjectif;
  majObjectif();

  const liste = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  document.getElementById('p-ok').onclick = async () => {
    const zone = document.getElementById('p-msg');
    const admins = [...liste(val('adm-t')), ...liste(val('adm-s'))];
    if (!admins.includes(session.email) && !confirm('Tu ne figures plus parmi les administrateurs. Tu perdras l’accès au back-office. Continuer ?')) return;
    try {
      await api('/api/admin/parametres', {
        methode: 'PUT',
        corps: {
          saison: { debut: val('p-debut'), fin: val('p-fin') },
          ratioMetresParContrat: Number(val('p-ratio')),
          contratsAnnuelsPrevus: Number(val('p-vol')),
          plafondJournalierMetres: Number(val('p-plafond')),
          paliers: p.paliers.map((_, i) => ({ pourcentage: Number(val(`pl-${i}`)), recompense: val(`rc-${i}`) })),
          effectifs: Object.fromEntries(config.couloirs.map((c) => [c.id, Number(val(`ef-${c.id}`))])),
          referents: Object.fromEntries(config.couloirs.map((c) => [c.id, liste(val(`rf-${c.id}`))])),
          administrateurs: admins,
        },
      });
      config = await api('/api/config');
      zone.innerHTML = '<div class="message ok">Paramètres enregistrés.</div>';
    } catch (e) {
      zone.innerHTML = msgErreur(e);
    }
  };
  document.getElementById('an-ok').onclick = async () => {
    const lignes = val('an').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [email, prenom, nom, couloir] = l.split(';').map((x) => x.trim());
      return { email, prenom, nom, couloir };
    });
    try {
      const r = await api('/api/admin/annuaire', { methode: 'POST', corps: lignes });
      document.getElementById('an-msg').innerHTML = `<div class="message ok">${r.ajouts} ajout(s). ${r.aInviter.length} collaborateur(s) à inviter : ${h(r.aInviter.slice(0, 20).join(', '))}${r.aInviter.length > 20 ? '…' : ''}</div>`;
    } catch (e) {
      document.getElementById('an-msg').innerHTML = msgErreur(e);
    }
  };
}

// ================= Journal =================

async function ongletJournal() {
  const journal = await api('/api/admin/journal');
  cadre('journal', `
    <section class="carte">
      <h2>Journal des actions d’administration</h2>
      <p class="sec">500 dernières entrées. Les consultations d’historique individuel y figurent.</p>
      <div class="filtres"><div><label for="j-f">Filtrer</label><input id="j-f" type="search" placeholder="Action, auteur, détail"></div></div>
      <div class="defile"><table class="dense"><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Détail</th></tr></thead><tbody id="j-t"></tbody></table></div>
    </section>`);
  const rendre = (f = '') => {
    const t = f.toLowerCase();
    document.getElementById('j-t').innerHTML = journal
      .filter((j) => !t || `${j.acteur} ${j.action} ${j.details}`.toLowerCase().includes(t))
      .map((j) => `<tr><td>${dateHeureFr(j.le)}</td><td>${h(j.acteur)}</td><td>${h(j.action)}</td><td>${h(j.details)}</td></tr>`)
      .join('') || '<tr><td colspan="4" class="sec">Aucune entrée.</td></tr>';
  };
  document.getElementById('j-f').oninput = (e) => rendre(e.target.value);
  rendre();
}

// ================= Routage =================

async function router() {
  const [cle, id] = (location.hash.slice(1) || 'pilotage').split('/');
  const ecrans = {
    pilotage: ongletPilotage,
    collaborateurs: () => (id ? ficheCollaborateur(id) : ongletCollaborateurs()),
    'hors-plafond': ongletHorsPlafond,
    contrats: ongletContrats,
    parametres: ongletParametres,
    journal: ongletJournal,
  };
  try {
    await (ecrans[cle] ?? ongletPilotage)();
  } catch (e) {
    cadre(cle, msgErreur(e));
  }
}

async function demarrer() {
  config = await api('/api/config');
  try {
    session = await api('/api/session');
  } catch (e) {
    if (e.statut === 401 && config.authMode === 'oidc') return location.assign('/auth/connexion');
    if (e.statut === 401 && config.authMode === 'dev') return location.assign('/');
    throw e;
  }
  if (!session.administrateur) {
    vue.innerHTML = '<h1>Back-office</h1><div class="message erreur" role="alert">Accès réservé aux administrateurs du défi.</div><p><a class="bouton" href="/">Retour à l’app</a></p>';
    return;
  }
  window.addEventListener('hashchange', router);
  router();
}

demarrer().catch((e) => {
  vue.innerHTML = msgErreur(e);
});
