// App mobile : inscription, accueil, déclaration, classement, fil.
import { api, h, km, kmCourt, kmSigne, m, entier, anneau, dateCourte } from './commun.js';

const vue = document.getElementById('vue');
const onglets = document.getElementById('onglets');
let config;
let session;

function appliquerLargeurs() {
  // Les largeurs de barres passent par le CSSOM : compatible avec la CSP sans style inline.
  for (const el of vue.querySelectorAll('[data-largeur]')) el.style.width = `${el.dataset.largeur}%`;
}

function afficher(html) {
  vue.innerHTML = html;
  appliquerLargeurs();
  vue.querySelector('h1')?.focus?.();
}

function erreur(e) {
  return `<div class="message erreur" role="alert">${h(e.message)}</div>`;
}

// ---------- Connexion simulée (AUTH_MODE=dev uniquement) ----------

async function ecranConnexionDev() {
  const annuaire = await api('/dev/connexion');
  afficher(`
    <h1 tabindex="-1">Connexion (démo)</h1>
    <p class="sec">En production, la connexion passe par le compte professionnel (SSO), sans mot de passe.</p>
    <div class="carte">
      <label for="email">Collaborateur</label>
      <select id="email">${annuaire.map((a) => `<option value="${h(a.email)}">${h(a.prenom)} ${h(a.nom)}</option>`).join('')}</select>
      <p></p>
      <button class="primaire pleine" id="go">Se connecter</button>
    </div>`);
  document.getElementById('go').onclick = async () => {
    await api('/dev/connexion', { methode: 'POST', corps: { email: document.getElementById('email').value } });
    demarrer();
  };
}

// ---------- Inscription : un seul écran, moins de 60 secondes ----------

function ecranInscription() {
  const fiche = session.annuaire;
  if (!fiche) {
    afficher(`<h1 tabindex="-1">Défi 1 contrat = ${config.ratioMetresParContrat} m</h1>
      <div class="carte"><p>Ton compte n’apparaît pas dans l’annuaire de la direction. Contacte l’administrateur du défi.</p></div>`);
    return;
  }
  const radios = (nom, options, coche) =>
    `<div class="choix" role="radiogroup">${options
      .map(([v, l], i) => `<div><input type="radio" id="${nom}-${i}" name="${nom}" value="${h(v)}" ${v === coche ? 'checked' : ''}><label for="${nom}-${i}">${h(l)}</label></div>`)
      .join('')}</div>`;
  afficher(`
    <h1 tabindex="-1">Bienvenue ${h(fiche.prenom)}</h1>
    <p class="sec">Chaque contrat signé ajoute ${config.ratioMetresParContrat} mètres au compteur commun. À nous de les couvrir, en courant, marchant ou pédalant.</p>
    <form id="f" class="carte" novalidate>
      <label for="couloir">Ton couloir</label>
      <select id="couloir">${config.couloirs.map((c) => `<option value="${c.id}" ${c.id === fiche.couloir ? 'selected' : ''}>${h(c.nom)}</option>`).join('')}</select>
      <p class="sec">Pré-rempli depuis l’annuaire. Modifiable une seule fois.</p>

      <label>Dans le fil, afficher</label>
      ${radios('affichage', [['prenom', fiche.prenom], ['initiales', `${fiche.prenom[0]}${fiche.nom[0]}`.toUpperCase()], ['anonyme', 'Anonyme']], 'prenom')}

      <label>Profil de départ <span class="sec">(facultatif)</span></label>
      ${radios('profil', Object.entries(config.profils).map(([k, p]) => [k, p.libelle]), null)}

      <label class="case"><input type="checkbox" id="rgpd">
        <span>J’accepte que mes sorties (activité, distance, date) soient utilisées pour le défi uniquement.
        Aucune donnée de santé. Désinscription possible à tout moment, avec suppression immédiate.
        Données supprimées 3 mois après la fin de saison.</span></label>
      <label class="case"><input type="checkbox" id="strava">
        <span>Me prévenir quand la synchronisation Strava sera disponible (lecture seule, révocable).</span></label>

      <div id="msg"></div>
      <button class="primaire pleine" type="submit">C’est parti</button>
    </form>`);
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const val = (n) => vue.querySelector(`input[name="${n}"]:checked`)?.value ?? null;
    try {
      await api('/api/inscription', {
        methode: 'POST',
        corps: {
          couloir: document.getElementById('couloir').value,
          affichage: val('affichage'),
          profil: val('profil'),
          consentementRgpd: document.getElementById('rgpd').checked,
          stravaInteret: document.getElementById('strava').checked,
        },
      });
      location.hash = '#declarer';
      demarrer();
    } catch (e) {
      document.getElementById('msg').innerHTML = erreur(e);
    }
  };
}

// ---------- Accueil ----------

async function ecranAccueil() {
  const a = await api('/api/accueil');
  const { courus, dus, ecart, objectif } = a.compteur;
  const p = a.paliers.prochain;
  afficher(`
    <h1 tabindex="-1">Le défi collectif</h1>
    ${a.premiereSortieAFaire ? `<div class="banniere">Première étape : déclare ta première sortie. <a class="bouton" href="#declarer">Déclarer</a></div>` : ''}
    <section class="carte anneau" aria-label="Compteur collectif">
      ${anneau(a.compteur, 140, kmCourt(courus))}
      <div>
        <div class="kpi"><div class="val ${ecart >= 0 ? 'positif' : 'negatif'}">${kmSigne(ecart)}</div>
          <div class="lib">${ecart >= 0 ? 'd’avance' : 'de retard'} sur les mètres dus</div></div>
        <p class="sec">${km(courus)} courus · ${km(dus)} dus<br>Objectif saison : ${km(objectif)}</p>
      </div>
    </section>
    <div class="grille">
      <section class="carte kpi"><div class="val">${km(a.contributionSemaine)}</div><div class="lib">Ma contribution cette semaine${a.rythmeSuggereKm ? ` · rythme indicatif ${a.rythmeSuggereKm} km` : ''}</div></section>
      <section class="carte kpi"><div class="val">${entier(a.contratsSemaine)}</div><div class="lib">Contrats signés cette semaine, soit ${km(a.metresDusSemaine)} à courir</div></section>
      <section class="carte kpi"><div class="val">${a.serie.courante}</div><div class="lib">Semaine${a.serie.courante > 1 ? 's' : ''} d’affilée${a.serie.semaineEnCoursFaite ? '' : ' · une sortie cette semaine prolonge la série'}</div></section>
      <section class="carte kpi"><div class="val">${p ? `${p.pourcentage} %` : 'Atteint'}</div><div class="lib">${p ? `Prochain palier, encore ${km(p.resteMetres)}${p.recompense ? ` · ${h(p.recompense)}` : ''}` : 'Tous les paliers sont franchis'}</div></section>
    </div>
    ${a.enAttenteValidation ? `<div class="message">${km(a.enAttenteValidation)} au-delà du plafond journalier, en attente de validation.</div>` : ''}
    <section class="carte">
      <h2>Mes badges</h2>
      <p class="sec">Visibles par toi seul, sauf si tu choisis de les partager.</p>
      <div class="badges">${a.badges
        .map((b) => `<span class="badge ${b.obtenu ? 'obtenu' : ''}" title="${h(b.description)}">${h(b.titre)}${b.obtenu ? ` <button data-partager="${h(b.id)}" aria-label="Partager le badge ${h(b.titre)} dans le fil">Partager</button>` : ''}</span>`)
        .join('')}</div>
    </section>
    <p><a class="bouton" href="#profil">Mon profil</a></p>`);
  for (const b of vue.querySelectorAll('[data-partager]')) {
    b.onclick = async () => {
      await api(`/api/badges/${b.dataset.partager}/partager`, { methode: 'POST', corps: {} });
      b.textContent = 'Partagé';
      b.disabled = true;
    };
  }
}

// ---------- Déclarer une sortie (moins de 20 secondes) ----------

function ecranDeclarer() {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  afficher(`
    <h1 tabindex="-1">Déclarer une sortie</h1>
    <form id="f" class="carte" novalidate>
      <label>Activité</label>
      <div class="choix" role="radiogroup">${Object.entries(config.activites)
        .map(([k, a], i) => `<div><input type="radio" id="act-${i}" name="activite" value="${k}" ${i === 0 ? 'checked' : ''}><label for="act-${i}">${h(a.libelle)}</label></div>`)
        .join('')}</div>
      <label for="distance">Distance (km)</label>
      <input id="distance" type="number" inputmode="decimal" min="0.1" max="300" step="0.1" required autofocus>
      <label for="date">Date</label>
      <input id="date" type="date" value="${aujourdhui}" max="${aujourdhui}">
      <p id="apercu" class="kpi" aria-live="polite"><span class="val">0 m</span> <span class="lib">comptés au compteur</span></p>
      <div id="msg"></div>
      <button class="primaire pleine" type="submit">Valider</button>
    </form>`);
  const f = document.getElementById('f');
  const apercu = () => {
    const act = f.querySelector('input[name="activite"]:checked').value;
    const d = Number(document.getElementById('distance').value.replace(',', '.')) || 0;
    const metres = Math.round(d * 1000 * config.activites[act].coefficient);
    document.getElementById('apercu').innerHTML =
      `<span class="val">${m(metres)}</span> <span class="lib">comptés au compteur${act === 'velo' ? ' (vélo ÷ 3)' : ''}</span>`;
  };
  f.oninput = apercu;
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const s = await api('/api/sorties', {
        methode: 'POST',
        corps: {
          activite: f.querySelector('input[name="activite"]:checked').value,
          distanceKm: Number(document.getElementById('distance').value.replace(',', '.')),
          date: document.getElementById('date').value,
        },
      });
      afficher(`
        <h1 tabindex="-1">Merci</h1>
        <div class="carte">
          <p class="kpi"><span class="val positif">+${m(s.metresComptes)}</span> <span class="lib">au compteur collectif</span></p>
          ${s.metresEnAttente ? `<p class="message">${m(s.metresEnAttente)} au-delà du plafond de ${km(config.plafondJournalierMetres)} par jour : validation par l’administrateur.</p>` : ''}
          <p><a class="bouton primaire pleine" href="#accueil">Voir le compteur</a></p>
          <p><a class="bouton pleine" href="#declarer" id="encore">Déclarer une autre sortie</a></p>
        </div>`);
      document.getElementById('encore').onclick = (e) => { e.preventDefault(); ecranDeclarer(); };
    } catch (e) {
      document.getElementById('msg').innerHTML = erreur(e);
    }
  };
}

// ---------- Classement par couloir ----------

async function ecranClassement() {
  const c = await api('/api/classement');
  const max = Math.max(1, ...c.saison.map((x) => x.metresParPersonne));
  const liste = (lignes) =>
    `<ol class="liste">${lignes
      .map((x) => `<li class="${x.couloir === c.couloirUtilisateur ? 'moi' : ''}">
        <div class="flex1">
          <strong>${h(x.nom)}</strong>${x.couloir === c.couloirUtilisateur ? ' <span class="sec">· mon couloir</span>' : ''}
          <div class="sec">${x.participants} participant${x.participants > 1 ? 's' : ''} sur ${x.effectif}</div>
          <div class="barre"><span data-largeur="${Math.round((x.metresParPersonne / max) * 100)}"></span></div>
        </div>
        <strong>${km(x.metresParPersonne)}<span class="sec">/pers.</span></strong></li>`)
      .join('')}</ol>`;
  afficher(`
    <h1 tabindex="-1">Classement des couloirs</h1>
    ${c.couloirDuMoisPrecedent ? `<div class="banniere">Couloir du mois dernier : ${h(c.couloirDuMoisPrecedent.nom)}</div>` : ''}
    <section class="carte"><h2>Saison</h2><p class="sec">Km par personne, sur l’effectif du couloir. Chaque nouvel inscrit fait progresser son équipe.</p>${liste(c.saison)}</section>
    <section class="carte"><h2>Ce mois-ci</h2>${liste(c.mois)}</section>`);
}

// ---------- Fil de l'équipe ----------

async function ecranFil() {
  const fil = await api('/api/fil');
  const item = (f) => {
    switch (f.type) {
      case 'palier':
        return `<li><div class="banniere flex1">Palier ${f.pourcentage} % franchi${f.recompense ? ` · ${h(f.recompense)}` : ''}</div></li>`;
      case 'contrats':
        return `<li><div><strong>+${m(f.metres)} à courir</strong><div class="sec">${entier(f.contrats)} contrats signés · ${dateCourte(f.le)}</div></div></li>`;
      case 'badge':
        return `<li><div><strong>${h(f.auteur)}</strong> a obtenu le badge « ${h(f.badge)} »<div class="sec">${dateCourte(f.le)}</div></div></li>`;
      case 'sortie':
        return `<li><div><strong>${h(f.auteur)}</strong> · ${h(f.activite)} · ${m(f.metres)}<div class="sec">${h(f.couloir)} · ${dateCourte(f.le)} · ${f.encouragements} encouragement${f.encouragements > 1 ? 's' : ''}</div></div>
          ${f.estMoi ? '' : `<button data-enc="${h(f.sortieId)}" ${f.dejaEncourage ? 'disabled' : ''} aria-label="Encourager ${h(f.auteur)}">${f.dejaEncourage ? 'Encouragé' : 'Encourager'}</button>`}</li>`;
      default:
        return '';
    }
  };
  afficher(`
    <h1 tabindex="-1">Fil de l’équipe</h1>
    <section class="carte">${fil.length ? `<ul class="liste">${fil.map(item).join('')}</ul>` : '<p class="sec">Rien pour l’instant. La première sortie lancera le fil.</p>'}</section>`);
  for (const b of vue.querySelectorAll('[data-enc]')) {
    b.onclick = async () => {
      await api(`/api/sorties/${b.dataset.enc}/encourager`, { methode: 'POST', corps: {} });
      b.textContent = 'Encouragé';
      b.disabled = true;
    };
  }
}

// ---------- Profil et désinscription ----------

async function ecranProfil() {
  const u = session.utilisateur;
  let referent = '';
  if (session.referentDe.length || session.administrateur) {
    const t = await api('/api/referent/inscriptions');
    referent = `<section class="carte"><h2>Inscriptions par couloir</h2>
      <table><thead><tr><th>Couloir</th><th>Inscrits</th><th>Taux</th></tr></thead><tbody>
      ${t.map((x) => `<tr><td>${h(x.nom)}</td><td>${x.inscrits} / ${x.effectif}</td><td>${Math.round(x.taux * 100)} %</td></tr>`).join('')}
      </tbody></table></section>`;
  }
  afficher(`
    <h1 tabindex="-1">Mon profil</h1>
    <section class="carte">
      <p><strong>${h(u.prenom)} ${h(u.nom)}</strong></p>
      <label for="aff">Affichage dans le fil</label>
      <select id="aff">${[['prenom', 'Prénom'], ['initiales', 'Initiales'], ['anonyme', 'Anonyme']]
        .map(([v, l]) => `<option value="${v}" ${u.affichage === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label for="couloir">Couloir</label>
      <select id="couloir" ${u.couloirModifie ? 'disabled' : ''}>${config.couloirs
        .map((c) => `<option value="${c.id}" ${c.id === u.couloir ? 'selected' : ''}>${h(c.nom)}</option>`).join('')}</select>
      <p class="sec">${u.couloirModifie ? 'Couloir déjà modifié une fois. Pour un changement, contacte l’administrateur.' : 'Modifiable une seule fois.'}</p>
      <div id="msg"></div>
      <button class="primaire pleine" id="enreg">Enregistrer</button>
    </section>
    ${referent}
    ${session.administrateur ? '<p><a class="bouton pleine" href="/admin.html">Back-office</a></p>' : ''}
    <p><a class="bouton pleine" href="/tableau.html">Tableau de bord</a></p>
    <section class="carte">
      <h2>Quitter le défi</h2>
      <p class="sec">Tes données personnelles sont supprimées immédiatement. Tes mètres restent au compteur collectif, anonymisés.</p>
      <button class="pleine" id="quitter">Me désinscrire</button>
    </section>`);
  document.getElementById('enreg').onclick = async () => {
    try {
      const corps = { affichage: document.getElementById('aff').value };
      const couloir = document.getElementById('couloir').value;
      if (couloir !== u.couloir) {
        if (!confirm('Le couloir ne pourra plus être modifié ensuite. Confirmer ?')) return;
        corps.couloir = couloir;
      }
      session.utilisateur = await api('/api/moi', { methode: 'PATCH', corps });
      document.getElementById('msg').innerHTML = '<div class="message ok">Enregistré.</div>';
    } catch (e) {
      document.getElementById('msg').innerHTML = erreur(e);
    }
  };
  document.getElementById('quitter').onclick = async () => {
    if (!confirm('Confirmer la désinscription et la suppression de tes données ?')) return;
    await api('/api/moi', { methode: 'DELETE' });
    location.hash = '';
    demarrer();
  };
}

// ---------- Routage ----------

const ECRANS = { accueil: ecranAccueil, declarer: ecranDeclarer, classement: ecranClassement, fil: ecranFil, profil: ecranProfil };

async function router() {
  const cle = location.hash.slice(1) || 'accueil';
  const ecran = ECRANS[cle] ?? ecranAccueil;
  for (const a of onglets.querySelectorAll('a')) {
    if (a.getAttribute('href') === `#${cle}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  try {
    await ecran();
  } catch (e) {
    afficher(erreur(e));
  }
}

async function demarrer() {
  config ??= await api('/api/config');
  try {
    session = await api('/api/session');
  } catch (e) {
    if (e.statut === 401 && config.authMode === 'dev') return ecranConnexionDev();
    return afficher(erreur(e));
  }
  if (!session.inscrit) {
    onglets.classList.add('cache');
    return ecranInscription();
  }
  onglets.classList.remove('cache');
  router();
}

window.addEventListener('hashchange', () => session?.inscrit && router());
demarrer();
