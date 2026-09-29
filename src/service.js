// Couche applicative : orchestre le store et les règles métier.
// Chaque méthode publique correspond à un usage décrit dans le cahier des charges.

import { ACTIVITES, AFFICHAGES, COULOIRS, PROFILS_DEPART } from './config.js';
import {
  appliquerPlafond,
  classementCouloirs,
  couloirDuMois,
  etatPaliers,
  metresCourus,
  metresDus,
  metresPonderes,
  objectifMetres,
  tauxParticipationMois,
} from './domain/regles.js';
import { badgesObtenus, nomAffiche, semaineIso, serieHebdomadaire, BADGES } from './domain/gamification.js';

export class ErreurMetier extends Error {
  constructor(message, statut = 400) {
    super(message);
    this.statut = statut;
  }
}

const DISTANCE_MAX_KM = 300;
const SEUIL_BADGE_MOTEUR = 20;

export class Service {
  constructor(store, { maintenant = () => new Date() } = {}) {
    this.store = store;
    this.maintenant = maintenant;
  }

  get e() {
    return this.store.etat;
  }

  aujourdhui() {
    return this.maintenant().toISOString().slice(0, 10);
  }

  // ---------- Journal d'audit des actions d'administration ----------

  journaliser(acteur, action, details = '', cibleUserId = null) {
    this.e.journal.push({ le: this.maintenant().toISOString(), acteur, action, details, cibleUserId });
  }

  // ---------- Identité et rôles ----------

  utilisateurParEmail(email) {
    return this.e.utilisateurs.find((u) => u.email === email.toLowerCase()) ?? null;
  }

  estAdministrateur(email) {
    return this.e.parametres.administrateurs.includes(email.toLowerCase());
  }

  couloirsReferent(email) {
    return Object.entries(this.e.parametres.referents)
      .filter(([, emails]) => emails.includes(email.toLowerCase()))
      .map(([couloir]) => couloir);
  }

  profilSession(email) {
    const annuaire = this.e.annuaire.find((a) => a.email === email.toLowerCase()) ?? null;
    const u = this.utilisateurParEmail(email);
    return {
      email: email.toLowerCase(),
      inscrit: Boolean(u),
      utilisateur: u,
      annuaire,
      administrateur: this.estAdministrateur(email),
      referentDe: this.couloirsReferent(email),
    };
  }

  // ---------- Inscription (moins de 60 secondes) ----------

  inscrire(email, { affichage, consentementRgpd, profil, stravaInteret = false, couloir }) {
    const cle = email.toLowerCase();
    if (this.utilisateurParEmail(cle)) throw new ErreurMetier('Déjà inscrit.', 409);
    const fiche = this.e.annuaire.find((a) => a.email === cle);
    if (!fiche) throw new ErreurMetier('Collaborateur absent de l’annuaire de la direction.', 403);
    if (consentementRgpd !== true) throw new ErreurMetier('Le consentement RGPD est requis pour participer.');
    if (!AFFICHAGES.includes(affichage)) throw new ErreurMetier('Choix d’affichage invalide.');
    if (profil && !PROFILS_DEPART[profil]) throw new ErreurMetier('Profil de départ invalide.');
    const couloirChoisi = couloir ?? fiche.couloir;
    if (!COULOIRS.some((c) => c.id === couloirChoisi)) throw new ErreurMetier('Couloir inconnu.');

    const u = {
      id: this.store.id(),
      email: cle,
      prenom: fiche.prenom,
      nom: fiche.nom,
      couloir: couloirChoisi,
      // Le couloir pré-rempli est modifiable une fois : un choix différent à l'inscription consomme ce droit.
      couloirModifie: couloirChoisi !== fiche.couloir,
      affichage,
      profil: profil ?? null,
      stravaInteret: Boolean(stravaInteret),
      consentementRgpdLe: this.maintenant().toISOString(),
      inscritLe: this.maintenant().toISOString(),
    };
    this.e.utilisateurs.push(u);
    this.store.sauver();
    return u;
  }

  modifierProfil(u, { affichage, couloir, profil }) {
    if (affichage !== undefined) {
      if (!AFFICHAGES.includes(affichage)) throw new ErreurMetier('Choix d’affichage invalide.');
      u.affichage = affichage;
    }
    if (profil !== undefined) {
      if (profil !== null && !PROFILS_DEPART[profil]) throw new ErreurMetier('Profil de départ invalide.');
      u.profil = profil;
    }
    if (couloir !== undefined && couloir !== u.couloir) {
      if (u.couloirModifie) throw new ErreurMetier('Le couloir a déjà été modifié. Contacte l’administrateur.', 403);
      if (!COULOIRS.some((c) => c.id === couloir)) throw new ErreurMetier('Couloir inconnu.');
      u.couloir = couloir;
      u.couloirModifie = true;
    }
    this.store.sauver();
    return u;
  }

  // Désinscription en un clic : suppression immédiate des données personnelles.
  // Les mètres courus restent au compteur collectif et au couloir, anonymisés.
  desinscrire(u) {
    for (const s of this.e.sorties) if (s.userId === u.id) s.userId = null;
    for (const f of this.e.fil) if (f.userId === u.id) f.userId = null;
    this.e.fil = this.e.fil.filter((f) => !(f.type === 'badge' && f.userId === null));
    this.e.encouragements = this.e.encouragements.filter((x) => x.deUserId !== u.id);
    this.e.utilisateurs = this.e.utilisateurs.filter((x) => x.id !== u.id);
    for (const j of this.e.journal) {
      if (j.cibleUserId === u.id) {
        j.cibleUserId = null;
        j.details = 'Collaborateur désinscrit';
      }
    }
    this.store.sauver();
  }

  // ---------- Sorties ----------

  validerSaisie({ activite, distanceKm, date }) {
    if (!ACTIVITES[activite]) throw new ErreurMetier('Activité inconnue.');
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km <= 0 || km > DISTANCE_MAX_KM) {
      throw new ErreurMetier(`Distance attendue entre 0 et ${DISTANCE_MAX_KM} km.`);
    }
    const jour = date ?? this.aujourdhui();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new ErreurMetier('Date invalide.');
    const { debut, fin } = this.e.parametres.saison;
    if (jour < debut || jour > fin) throw new ErreurMetier(`Date hors saison (du ${debut} au ${fin}).`);
    if (jour > this.aujourdhui()) throw new ErreurMetier('Date dans le futur.');
    return { km, jour };
  }

  // Pondération puis plafond journalier, en tenant compte des autres sorties du même jour.
  calculerComptes(userId, activite, distanceMetres, jour, sauf = null) {
    const ponderes = metresPonderes(activite, distanceMetres);
    const dejaComptes = this.e.sorties
      .filter((s) => s.id !== sauf && s.userId === userId && s.date === jour)
      .reduce((s, x) => s + x.metresComptes + x.metresEnAttente, 0);
    return { ponderes, ...appliquerPlafond(dejaComptes, ponderes, this.e.parametres.plafondJournalierMetres) };
  }

  declarerSortie(u, saisie) {
    const { activite } = saisie;
    const { km, jour } = this.validerSaisie(saisie);

    const distanceMetres = Math.round(km * 1000);
    const { ponderes, comptes, enAttente } = this.calculerComptes(u.id, activite, distanceMetres, jour);

    const sortie = {
      id: this.store.id(),
      userId: u.id,
      couloir: u.couloir,
      activite,
      distanceMetres,
      date: jour,
      metresPonderes: ponderes,
      metresComptes: comptes,
      metresEnAttente: enAttente,
      statutPlafond: enAttente > 0 ? 'en_attente' : null,
      creeLe: this.maintenant().toISOString(),
    };
    this.e.sorties.push(sortie);
    this.e.fil.push({
      id: this.store.id(),
      type: 'sortie',
      le: sortie.creeLe,
      userId: u.id,
      sortieId: sortie.id,
      couloir: u.couloir,
      activite,
    });
    this.verifierPaliers();
    this.store.sauver();
    return sortie;
  }

  // ---------- Contrats (seul flux métier : un total par jour, sans donnée client) ----------

  enregistrerContrats(date, nombre, acteur = null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ErreurMetier('Date invalide.');
    const n = Number(nombre);
    if (!Number.isInteger(n) || n < 0) throw new ErreurMetier('Nombre de contrats invalide.');
    const existant = this.e.contrats.find((c) => c.date === date);
    const delta = n - (existant?.nombre ?? 0);
    if (existant) existant.nombre = n;
    else this.e.contrats.push({ date, nombre: n });
    if (acteur && delta !== 0) this.journaliser(acteur, 'Contrats saisis', `${date} : ${n}`);
    if (delta > 0) {
      this.e.fil.push({
        id: this.store.id(),
        type: 'contrats',
        le: this.maintenant().toISOString(),
        date,
        contrats: delta,
        metres: delta * this.e.parametres.ratioMetresParContrat,
      });
    }
    this.store.sauver();
    return { date, nombre: n, delta };
  }

  // ---------- Paliers ----------

  verifierPaliers() {
    const { paliers } = etatPaliers(metresCourus(this.e.sorties), this.e.parametres);
    for (const p of paliers) {
      if (p.atteint && !this.e.paliersFranchis.includes(p.pourcentage)) {
        this.e.paliersFranchis.push(p.pourcentage);
        this.e.fil.push({
          id: this.store.id(),
          type: 'palier',
          le: this.maintenant().toISOString(),
          pourcentage: p.pourcentage,
          recompense: p.recompense,
        });
      }
    }
  }

  // ---------- Encouragements et badges ----------

  encourager(u, sortieId) {
    const sortie = this.e.sorties.find((s) => s.id === sortieId);
    if (!sortie) throw new ErreurMetier('Sortie introuvable.', 404);
    if (sortie.userId === u.id) throw new ErreurMetier('On encourage les autres.');
    if (this.e.encouragements.some((x) => x.deUserId === u.id && x.sortieId === sortieId)) {
      return { deja: true };
    }
    this.e.encouragements.push({ id: this.store.id(), deUserId: u.id, sortieId, le: this.maintenant().toISOString() });
    this.store.sauver();
    return { deja: false };
  }

  badges(u) {
    return badgesObtenus({
      sorties: this.e.sorties.filter((s) => s.userId === u.id),
      encouragementsDonnes: this.e.encouragements.filter((x) => x.deUserId === u.id).length,
      aujourdhui: this.aujourdhui(),
    });
  }

  // Les badges sont privés ; leur titulaire choisit de les partager dans le fil.
  partagerBadge(u, badgeId) {
    const b = this.badges(u).find((x) => x.id === badgeId);
    if (!b || !b.obtenu) throw new ErreurMetier('Badge non obtenu.');
    if (this.e.fil.some((f) => f.type === 'badge' && f.userId === u.id && f.badgeId === badgeId)) return;
    this.e.fil.push({ id: this.store.id(), type: 'badge', le: this.maintenant().toISOString(), userId: u.id, badgeId });
    this.store.sauver();
  }

  // ---------- Vues ----------

  compteur() {
    const jour = this.aujourdhui();
    const courus = metresCourus(this.e.sorties);
    const dus = metresDus(this.e.contrats, this.e.parametres, jour);
    return { courus, dus, ecart: courus - dus, objectif: objectifMetres(this.e.parametres) };
  }

  accueil(u) {
    const jour = this.aujourdhui();
    const semaine = semaineIso(jour);
    const mesSorties = this.e.sorties.filter((s) => s.userId === u.id);
    const contratsSemaine = this.e.contrats
      .filter((c) => semaineIso(c.date) === semaine)
      .reduce((s, c) => s + c.nombre, 0);
    const compteur = this.compteur();
    const profil = u.profil ? PROFILS_DEPART[u.profil] : null;
    return {
      saison: this.e.parametres.saison,
      avantSaison: jour < this.e.parametres.saison.debut,
      compteur,
      paliers: etatPaliers(compteur.courus, this.e.parametres),
      contributionSemaine: mesSorties.filter((s) => semaineIso(s.date) === semaine).reduce((s, x) => s + x.metresComptes, 0),
      contributionTotale: metresCourus(mesSorties),
      enAttenteValidation: mesSorties.reduce((s, x) => s + (x.statutPlafond === 'en_attente' ? x.metresEnAttente : 0), 0),
      contratsSemaine,
      metresDusSemaine: contratsSemaine * this.e.parametres.ratioMetresParContrat,
      serie: serieHebdomadaire(mesSorties.map((s) => s.date), jour),
      rythmeSuggereKm: profil?.rythmeKmSemaine ?? null,
      premiereSortieAFaire: mesSorties.length === 0,
      badges: this.badges(u),
    };
  }

  classement(u) {
    const jour = this.aujourdhui();
    return {
      saison: classementCouloirs(this.e.sorties, this.e.parametres),
      mois: classementCouloirs(this.e.sorties, this.e.parametres, { depuis: `${jour.slice(0, 7)}-01`, jusquau: jour }),
      couloirUtilisateur: u?.couloir ?? null,
      couloirDuMoisPrecedent: couloirDuMois(this.e.sorties, this.e.parametres, moisPrecedent(jour)),
    };
  }

  fil(u, limite = 50) {
    const parId = new Map(this.e.utilisateurs.map((x) => [x.id, x]));
    const nomCouloir = Object.fromEntries(COULOIRS.map((c) => [c.id, c.nom]));
    return [...this.e.fil]
      .sort((a, b) => b.le.localeCompare(a.le))
      .slice(0, limite)
      .map((f) => {
        const base = { id: f.id, type: f.type, le: f.le };
        switch (f.type) {
          case 'sortie': {
            const sortie = this.e.sorties.find((s) => s.id === f.sortieId);
            const enc = this.e.encouragements.filter((x) => x.sortieId === f.sortieId);
            return {
              ...base,
              sortieId: f.sortieId,
              auteur: nomAffiche(parId.get(f.userId)),
              couloir: nomCouloir[f.couloir],
              activite: ACTIVITES[f.activite].libelle,
              metres: sortie?.metresComptes ?? 0,
              encouragements: enc.length,
              dejaEncourage: Boolean(u && enc.some((x) => x.deUserId === u.id)),
              estMoi: Boolean(u && f.userId === u.id),
            };
          }
          case 'contrats':
            return { ...base, contrats: f.contrats, metres: f.metres, date: f.date };
          case 'palier':
            return { ...base, pourcentage: f.pourcentage, recompense: f.recompense };
          case 'badge':
            return { ...base, auteur: nomAffiche(parId.get(f.userId)), badge: BADGES.find((b) => b.id === f.badgeId)?.titre };
          default:
            return base;
        }
      });
  }

  tableauDeBord() {
    const jour = this.aujourdhui();
    const compteur = this.compteur();
    const classement = classementCouloirs(this.e.sorties, this.e.parametres);
    const participation = tauxParticipationMois(this.e.sorties, this.e.parametres, jour.slice(0, 7));
    const inscrits = this.e.utilisateurs.length;
    return {
      jour,
      ratioMetresParContrat: this.e.parametres.ratioMetresParContrat,
      compteur,
      paliers: etatPaliers(compteur.courus, this.e.parametres),
      classement,
      couloirDuMois: couloirDuMois(this.e.sorties, this.e.parametres, jour.slice(0, 7)),
      indicateurs: {
        ecartPositif: compteur.ecart >= 0,
        participationMois: participation,
        couloirsAuSeuil: classement.filter((c) => c.seuilAtteint).length,
        inscrits,
      },
    };
  }

  // Réservé aux référents (leurs couloirs) et à l'administrateur (tous).
  tauxInscription(couloirs) {
    return COULOIRS.filter((c) => couloirs.includes(c.id)).map((c) => {
      const inscrits = this.e.utilisateurs.filter((u) => u.couloir === c.id).length;
      const effectif = this.e.parametres.effectifs[c.id] ?? 0;
      return { couloir: c.id, nom: c.nom, inscrits, effectif, taux: effectif ? inscrits / effectif : 0 };
    });
  }

  // ---------- Back-office ----------

  modifierParametres(maj, acteur = 'systeme') {
    const p = this.e.parametres;
    if (maj.ratioMetresParContrat !== undefined) {
      const r = Number(maj.ratioMetresParContrat);
      if (!(r > 0)) throw new ErreurMetier('Ratio invalide.');
      p.ratioMetresParContrat = r;
    }
    if (maj.saison !== undefined) {
      const { debut, fin } = { ...p.saison, ...maj.saison };
      if (![debut, fin].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || debut >= fin) throw new ErreurMetier('Saison invalide.');
      p.saison = { debut, fin };
    }
    if (maj.contratsAnnuelsPrevus !== undefined) {
      const n = Number(maj.contratsAnnuelsPrevus);
      if (!(Number.isInteger(n) && n > 0)) throw new ErreurMetier('Volume de contrats invalide.');
      p.contratsAnnuelsPrevus = n;
    }
    if (maj.plafondJournalierMetres !== undefined) {
      const n = Number(maj.plafondJournalierMetres);
      if (!(n > 0)) throw new ErreurMetier('Plafond invalide.');
      p.plafondJournalierMetres = n;
    }
    if (maj.paliers !== undefined) {
      if (!Array.isArray(maj.paliers) || maj.paliers.some((x) => !(x.pourcentage > 0 && x.pourcentage <= 100))) {
        throw new ErreurMetier('Paliers invalides.');
      }
      p.paliers = maj.paliers.map((x) => ({ pourcentage: Number(x.pourcentage), recompense: String(x.recompense ?? '') }));
    }
    if (maj.effectifs !== undefined) {
      for (const c of COULOIRS) {
        if (maj.effectifs[c.id] !== undefined) p.effectifs[c.id] = Math.max(0, Number(maj.effectifs[c.id]) | 0);
      }
    }
    if (maj.administrateurs !== undefined) p.administrateurs = maj.administrateurs.map((x) => x.toLowerCase());
    if (maj.referents !== undefined) {
      p.referents = Object.fromEntries(
        Object.entries(maj.referents).map(([k, v]) => [k, v.map((x) => x.toLowerCase())]),
      );
    }
    this.journaliser(acteur, 'Paramètres modifiés', Object.keys(maj).join(', '));
    this.verifierPaliers();
    this.store.sauver();
    return p;
  }

  rattacher(userId, couloir, acteur = 'systeme') {
    const u = this.e.utilisateurs.find((x) => x.id === userId);
    if (!u) throw new ErreurMetier('Collaborateur introuvable.', 404);
    if (!COULOIRS.some((c) => c.id === couloir)) throw new ErreurMetier('Couloir inconnu.');
    this.journaliser(acteur, 'Couloir modifié', `${u.prenom} ${u.nom} : ${u.couloir} → ${couloir}`, u.id);
    u.couloir = couloir;
    this.store.sauver();
    return u;
  }

  fileHorsPlafond() {
    const parId = new Map(this.e.utilisateurs.map((x) => [x.id, x]));
    return this.e.sorties
      .filter((s) => s.statutPlafond === 'en_attente')
      .map((s) => {
        const u = parId.get(s.userId);
        return { ...s, collaborateur: u ? `${u.prenom} ${u.nom}` : 'Anonymisé' };
      });
  }

  traiterHorsPlafond(sortieId, decision, acteur = 'systeme') {
    const s = this.e.sorties.find((x) => x.id === sortieId && x.statutPlafond === 'en_attente');
    if (!s) throw new ErreurMetier('Déclaration introuvable dans la file.', 404);
    if (decision === 'valider') s.metresComptes += s.metresEnAttente;
    else if (decision !== 'refuser') throw new ErreurMetier('Décision attendue : valider ou refuser.');
    s.metresEnAttente = 0;
    s.statutPlafond = decision === 'valider' ? 'valide' : 'refuse';
    this.journaliser(acteur, decision === 'valider' ? 'Hors plafond validé' : 'Hors plafond refusé', `Sortie du ${s.date}`, s.userId);
    this.verifierPaliers();
    this.store.sauver();
    return s;
  }

  importerAnnuaire(lignes, acteur = 'systeme') {
    let ajouts = 0;
    for (const l of lignes) {
      const email = l.email.toLowerCase();
      if (!COULOIRS.some((c) => c.id === l.couloir)) throw new ErreurMetier(`Couloir inconnu pour ${email}.`);
      const existant = this.e.annuaire.find((a) => a.email === email);
      if (existant) Object.assign(existant, { prenom: l.prenom, nom: l.nom, couloir: l.couloir });
      else {
        this.e.annuaire.push({ email, prenom: l.prenom, nom: l.nom, couloir: l.couloir });
        ajouts += 1;
      }
    }
    this.journaliser(acteur, 'Annuaire importé', `${lignes.length} ligne(s), ${ajouts} ajout(s)`);
    this.store.sauver();
    // Les nouveaux arrivants sont à inviter : la liste sert à l'envoi du mail d'invitation.
    return { ajouts, aInviter: this.e.annuaire.filter((a) => !this.utilisateurParEmail(a.email)).map((a) => a.email) };
  }

  exportCsv(acteur = null) {
    if (acteur) {
      this.journaliser(acteur, 'Export CSV');
      this.store.sauver();
    }
    const entete = 'date;couloir;activite;distance_m;metres_ponderes;metres_comptes;metres_en_attente;statut_plafond';
    const lignes = [...this.e.sorties]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) =>
        [s.date, s.couloir, s.activite, s.distanceMetres, s.metresPonderes, s.metresComptes, s.metresEnAttente, s.statutPlafond ?? ''].join(';'),
      );
    return [entete, ...lignes].join('\n') + '\n';
  }

  // ---------- Administration des collaborateurs ----------

  listeCollaborateurs() {
    const jour = this.aujourdhui();
    return this.e.utilisateurs
      .map((u) => {
        const mes = this.e.sorties.filter((s) => s.userId === u.id);
        const derniere = mes.reduce((d, s) => (s.date > d ? s.date : d), '');
        return {
          id: u.id,
          email: u.email,
          prenom: u.prenom,
          nom: u.nom,
          couloir: u.couloir,
          inscritLe: u.inscritLe.slice(0, 10),
          sorties: mes.length,
          metres: metresCourus(mes),
          derniereSortie: derniere || null,
          inactif14j: !derniere || ecartJours(derniere, jour) >= 14,
        };
      })
      .sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom));
  }

  // Historique individuel : donnée personnelle, chaque consultation est tracée.
  ficheCollaborateur(userId, acteur) {
    const u = this.e.utilisateurs.find((x) => x.id === userId);
    if (!u) throw new ErreurMetier('Collaborateur introuvable.', 404);
    this.journaliser(acteur, 'Historique consulté', `${u.prenom} ${u.nom}`, u.id);
    this.store.sauver();
    const { id, email, prenom, nom, couloir, affichage, profil, inscritLe } = u;
    return {
      id, email, prenom, nom, couloir, affichage, profil, inscritLe,
      sorties: this.e.sorties.filter((s) => s.userId === u.id).sort((a, b) => b.date.localeCompare(a.date)),
      badges: this.badges(u).filter((b) => b.obtenu).map((b) => b.titre),
    };
  }

  corrigerSortie(sortieId, maj, acteur) {
    const s = this.e.sorties.find((x) => x.id === sortieId);
    if (!s) throw new ErreurMetier('Sortie introuvable.', 404);
    const saisie = {
      activite: maj.activite ?? s.activite,
      distanceKm: maj.distanceKm ?? s.distanceMetres / 1000,
      date: maj.date ?? s.date,
    };
    const { km, jour } = this.validerSaisie(saisie);
    const avant = `${s.activite} ${s.distanceMetres / 1000} km le ${s.date}`;
    const distanceMetres = Math.round(km * 1000);
    if (saisie.activite === s.activite && distanceMetres === s.distanceMetres && jour === s.date) return s;
    const { ponderes, comptes, enAttente } = this.calculerComptes(s.userId, saisie.activite, distanceMetres, jour, s.id);
    Object.assign(s, {
      activite: saisie.activite,
      distanceMetres,
      date: jour,
      metresPonderes: ponderes,
      metresComptes: comptes,
      metresEnAttente: enAttente,
      statutPlafond: enAttente > 0 ? 'en_attente' : null,
    });
    const f = this.e.fil.find((x) => x.sortieId === s.id);
    if (f) f.activite = s.activite;
    this.journaliser(acteur, 'Sortie corrigée', `${avant} → ${s.activite} ${km} km le ${jour}`, s.userId);
    this.verifierPaliers();
    this.store.sauver();
    return s;
  }

  supprimerSortie(sortieId, acteur) {
    const s = this.e.sorties.find((x) => x.id === sortieId);
    if (!s) throw new ErreurMetier('Sortie introuvable.', 404);
    this.e.sorties = this.e.sorties.filter((x) => x.id !== sortieId);
    this.e.fil = this.e.fil.filter((x) => x.sortieId !== sortieId);
    this.e.encouragements = this.e.encouragements.filter((x) => x.sortieId !== sortieId);
    this.journaliser(acteur, 'Sortie supprimée', `${s.activite} ${s.distanceMetres / 1000} km le ${s.date}`, s.userId);
    this.store.sauver();
  }

  desinscrireParAdmin(userId, acteur) {
    const u = this.e.utilisateurs.find((x) => x.id === userId);
    if (!u) throw new ErreurMetier('Collaborateur introuvable.', 404);
    this.journaliser(acteur, 'Désinscription par l’administrateur', `${u.prenom} ${u.nom}`, u.id);
    this.desinscrire(u);
  }

  // ---------- Pilotage ----------

  // Semaine par semaine depuis le début de saison : ce qui a été couru, ce qui était dû.
  evolutionHebdomadaire() {
    const { debut } = this.e.parametres.saison;
    const jour = this.aujourdhui();
    const ratio = this.e.parametres.ratioMetresParContrat;
    const semaines = new Map();
    for (let d = debut; d <= jour; d = ajouterJours(d, 1)) {
      const k = semaineIso(d);
      if (!semaines.has(k)) semaines.set(k, { semaine: k, debut: d, courus: 0, dus: 0, sorties: 0, actifs: new Set(), nouveauxInscrits: 0 });
    }
    for (const s of this.e.sorties) {
      const w = semaines.get(semaineIso(s.date));
      if (!w || s.date < debut) continue;
      w.courus += s.metresComptes;
      w.sorties += 1;
      if (s.userId) w.actifs.add(s.userId);
    }
    for (const c of this.e.contrats) {
      const w = semaines.get(semaineIso(c.date));
      if (w && c.date >= debut) w.dus += c.nombre * ratio;
    }
    for (const u of this.e.utilisateurs) {
      const w = semaines.get(semaineIso(u.inscritLe.slice(0, 10)));
      if (w) w.nouveauxInscrits += 1;
    }
    let cumulCourus = 0;
    let cumulDus = 0;
    return [...semaines.values()].map((w) => {
      cumulCourus += w.courus;
      cumulDus += w.dus;
      return { ...w, actifs: w.actifs.size, cumulCourus, cumulDus, ecart: cumulCourus - cumulDus };
    });
  }

  // Projection au rythme des 28 derniers jours (ou depuis le début de saison si plus récent).
  projection() {
    const { debut, fin } = this.e.parametres.saison;
    const jour = this.aujourdhui();
    if (jour < debut) return { disponible: false, raison: `La saison démarre le ${debut}.` };
    const depuis = [ajouterJours(jour, -27), debut].sort().at(-1);
    const jours = ecartJours(depuis, jour) + 1;
    const courus = metresCourus(this.e.sorties.filter((s) => s.date >= depuis && s.date <= jour));
    const dus = this.e.contrats.filter((c) => c.date >= depuis && c.date <= jour).reduce((s, c) => s + c.nombre, 0) *
      this.e.parametres.ratioMetresParContrat;
    const rythmeCourus = courus / jours;
    const rythmeDus = dus / jours;
    const restants = Math.max(0, ecartJours(jour, fin));
    const compteur = this.compteur();
    const { paliers } = etatPaliers(compteur.courus, this.e.parametres);
    return {
      disponible: true,
      baseJours: jours,
      rythmeCourusSemaine: Math.round(rythmeCourus * 7),
      rythmeDusSemaine: Math.round(rythmeDus * 7),
      joursRestants: restants,
      ecartProjete: Math.round(compteur.ecart + (rythmeCourus - rythmeDus) * restants),
      courusProjetes: Math.round(compteur.courus + rythmeCourus * restants),
      paliers: paliers.map((p) => {
        if (p.atteint) return { pourcentage: p.pourcentage, atteint: true, dateEstimee: null };
        const j = rythmeCourus > 0 ? Math.ceil(p.resteMetres / rythmeCourus) : null;
        const date = j === null ? null : ajouterJours(jour, j);
        return { pourcentage: p.pourcentage, atteint: false, dateEstimee: date && date <= fin ? date : null };
      }),
    };
  }

  // Signaux d'attrition, agrégés par couloir : aucun nom.
  attrition() {
    const liste = this.listeCollaborateurs();
    return COULOIRS.map((c) => {
      const du = liste.filter((u) => u.couloir === c.id);
      return {
        couloir: c.id,
        nom: c.nom,
        inscrits: du.length,
        jamaisSortis: du.filter((u) => !u.derniereSortie).length,
        inactifs14j: du.filter((u) => u.derniereSortie && u.inactif14j).length,
        actifs14j: du.filter((u) => !u.inactif14j).length,
      };
    });
  }

  // Conservation : suppression des données personnelles 3 mois après la fin de saison.
  purgeRgpd() {
    const fin = new Date(`${this.e.parametres.saison.fin}T00:00:00Z`);
    fin.setUTCMonth(fin.getUTCMonth() + 3);
    if (this.maintenant() < fin) return { purge: false, echeance: fin.toISOString().slice(0, 10) };
    for (const u of [...this.e.utilisateurs]) this.desinscrire(u);
    this.e.annuaire = [];
    this.e.journal = [];
    this.store.sauver();
    return { purge: true, echeance: fin.toISOString().slice(0, 10) };
  }
}

function ajouterJours(jour, n) {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ecartJours(de, a) {
  return Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / 86400000);
}

function moisPrecedent(jour) {
  const [a, m] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
