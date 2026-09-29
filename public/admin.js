// Back-office minimal : moins d'une heure d'administration par semaine.
import { api, h, m } from './commun.js';

const vue = document.getElementById('vue');
let config;

function notifier(id, e) {
  document.getElementById(id).innerHTML = e
    ? `<div class="message erreur" role="alert">${h(e.message)}</div>`
    : '<div class="message ok">Enregistré.</div>';
}

async function rendre() {
  config ??= await api('/api/config');
  const [p, file, utilisateurs, contrats] = await Promise.all([
    api('/api/admin/parametres'),
    api('/api/admin/hors-plafond'),
    api('/api/admin/utilisateurs'),
    api('/api/admin/contrats'),
  ]);
  const optCouloirs = (sel) => config.couloirs.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${h(c.nom)}</option>`).join('');
  const aujourdhui = new Date().toISOString().slice(0, 10);

  vue.innerHTML = `
    <h1>Back-office du défi</h1>
    <p><a class="bouton" href="/">Retour à l’app</a> <a class="bouton" href="/tableau.html">Tableau de bord</a> <a class="bouton" href="/api/admin/export.csv">Export CSV</a></p>

    <section class="carte">
      <h2>Déclarations hors plafond (${file.length})</h2>
      ${file.length ? `<table><thead><tr><th>Date</th><th>Collaborateur</th><th>Activité</th><th>Comptés</th><th>En attente</th><th></th></tr></thead><tbody>
        ${file.map((s) => `<tr><td>${s.date}</td><td>${h(s.collaborateur)}</td><td>${h(s.activite)}</td><td>${m(s.metresComptes)}</td><td>${m(s.metresEnAttente)}</td>
          <td><button data-dec="valider" data-id="${s.id}">Valider</button> <button data-dec="refuser" data-id="${s.id}">Refuser</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="sec">Aucune déclaration en attente.</p>'}
    </section>

    <section class="carte">
      <h2>Contrats signés</h2>
      <p class="sec">Normalement alimenté chaque jour par l’extraction automatique. Saisie manuelle en secours : total du jour.</p>
      <div class="grille">
        <div><label for="c-date">Date</label><input id="c-date" type="date" value="${aujourdhui}"></div>
        <div><label for="c-nb">Contrats</label><input id="c-nb" type="number" min="0" step="1"></div>
      </div>
      <p></p><button class="primaire" id="c-ok">Enregistrer</button><div id="c-msg"></div>
      <p class="sec">Derniers jours : ${contrats.slice(0, 7).map((c) => `${c.date} · ${c.nombre}`).join(' | ') || 'aucun'}</p>
    </section>

    <section class="carte">
      <h2>Paramètres</h2>
      <div class="grille">
        <div><label for="p-ratio">Mètres par contrat</label><input id="p-ratio" type="number" min="1" value="${p.ratioMetresParContrat}"></div>
        <div><label for="p-vol">Contrats prévus sur l’année</label><input id="p-vol" type="number" min="1" value="${p.contratsAnnuelsPrevus}"></div>
        <div><label for="p-plafond">Plafond / pers. / jour (m)</label><input id="p-plafond" type="number" min="1000" step="1000" value="${p.plafondJournalierMetres}"></div>
        <div><label for="p-debut">Début de saison (base des mètres dus)</label><input id="p-debut" type="date" value="${p.saison.debut}"></div>
      </div>
      <h2>Paliers et récompenses</h2>
      ${p.paliers.map((x, i) => `<div class="grille"><div><label for="pl-${i}">Palier (%)</label><input id="pl-${i}" type="number" min="1" max="100" value="${x.pourcentage}"></div>
        <div><label for="rc-${i}">Récompense</label><input id="rc-${i}" value="${h(x.recompense)}"></div></div>`).join('')}
      <h2>Effectifs et référents par couloir</h2>
      ${config.couloirs.map((c) => `<div class="grille"><div><label for="ef-${c.id}">${h(c.nom)} · effectif</label><input id="ef-${c.id}" type="number" min="0" value="${p.effectifs[c.id] ?? 0}"></div>
        <div><label for="rf-${c.id}">Référents (emails, virgules)</label><input id="rf-${c.id}" value="${h((p.referents[c.id] ?? []).join(', '))}"></div></div>`).join('')}
      <label for="p-admins">Administrateurs (emails, virgules)</label><input id="p-admins" value="${h(p.administrateurs.join(', '))}">
      <p></p><button class="primaire" id="p-ok">Enregistrer les paramètres</button><div id="p-msg"></div>
    </section>

    <section class="carte">
      <h2>Rattachement aux couloirs (${utilisateurs.length} inscrits)</h2>
      <table><tbody>${utilisateurs.map((u) => `<tr><td>${h(u.prenom)} ${h(u.nom)}</td><td><select data-ratt="${u.id}" aria-label="Couloir de ${h(u.prenom)} ${h(u.nom)}">${optCouloirs(u.couloir)}</select></td></tr>`).join('')}</tbody></table>
    </section>

    <section class="carte">
      <h2>Annuaire</h2>
      <p class="sec">Une ligne par collaborateur : email;prénom;nom;couloir (${config.couloirs.map((c) => c.id).join(', ')}).</p>
      <textarea id="an" rows="5" class="pleine"></textarea>
      <p></p><button class="primaire" id="an-ok">Importer</button><div id="an-msg"></div>
    </section>`;

  for (const b of vue.querySelectorAll('[data-dec]')) {
    b.onclick = async () => { await api(`/api/admin/hors-plafond/${b.dataset.id}`, { methode: 'POST', corps: { decision: b.dataset.dec } }); rendre(); };
  }
  for (const s of vue.querySelectorAll('[data-ratt]')) {
    s.onchange = async () => { await api(`/api/admin/utilisateurs/${s.dataset.ratt}/couloir`, { methode: 'POST', corps: { couloir: s.value } }); };
  }
  document.getElementById('c-ok').onclick = async () => {
    try {
      await api('/api/admin/contrats', { methode: 'POST', corps: { date: document.getElementById('c-date').value, nombre: Number(document.getElementById('c-nb').value) } });
      rendre();
    } catch (e) { notifier('c-msg', e); }
  };
  const liste = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  document.getElementById('p-ok').onclick = async () => {
    const val = (id) => document.getElementById(id).value;
    try {
      await api('/api/admin/parametres', {
        methode: 'PUT',
        corps: {
          ratioMetresParContrat: Number(val('p-ratio')),
          contratsAnnuelsPrevus: Number(val('p-vol')),
          plafondJournalierMetres: Number(val('p-plafond')),
          saison: { debut: val('p-debut') },
          paliers: p.paliers.map((_, i) => ({ pourcentage: Number(val(`pl-${i}`)), recompense: val(`rc-${i}`) })),
          effectifs: Object.fromEntries(config.couloirs.map((c) => [c.id, Number(val(`ef-${c.id}`))])),
          referents: Object.fromEntries(config.couloirs.map((c) => [c.id, liste(val(`rf-${c.id}`))])),
          administrateurs: liste(val('p-admins')),
        },
      });
      notifier('p-msg');
    } catch (e) { notifier('p-msg', e); }
  };
  document.getElementById('an-ok').onclick = async () => {
    const lignes = document.getElementById('an').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [email, prenom, nom, couloir] = l.split(';').map((x) => x.trim());
      return { email, prenom, nom, couloir };
    });
    try {
      const r = await api('/api/admin/annuaire', { methode: 'POST', corps: lignes });
      document.getElementById('an-msg').innerHTML = `<div class="message ok">${r.ajouts} ajout(s). ${r.aInviter.length} collaborateur(s) à inviter.</div>`;
    } catch (e) { notifier('an-msg', e); }
  };
}

rendre().catch((e) => { vue.innerHTML = `<div class="message erreur" role="alert">${h(e.message)}</div>`; });
