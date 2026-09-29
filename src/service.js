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
    this.store.sauver();
  }

  // ---------- Sorties ----------

  declarerSortie(u, { activite, distanceKm, date }) {
    if (!ACTIVITES[activite]) throw new ErreurMetier('Activité inconnue.');
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km <= 0 || km > DISTANCE_MAX_KM) {
      throw new ErreurMetier(`Distance attendue entre 0 et ${DISTANCE_MAX_KM} km.`);
    }
    const jour = date ?? this.aujourdhui();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new ErreurMetier('Date invalide.');
    const { debut, fin } = this.e.parametres.saison;
    if (jour < debut || jour > fin) throw new ErreurMetier('Date hors saison.');
    if (jour > this.aujourdhui()) throw new ErreurMetier('Date dans le futur.');

    const distanceMetres = Math.round(km * 1000);
    const ponderes = metresPonderes(activite, distanceMetres);
    const dejaComptes = this.e.sorties
      .filter((s) => s.userId === u.id && s.date === jour)
      .reduce((s, x) => s + x.metresComptes + x.metresEnAttente, 0);
    const { comptes, enAttente } = appliquerPlafond(dejaComptes, ponderes, this.e.parametres.plafondJournalierMetres);

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
      metres: comptes,
    });
    this.verifierPaliers();
    this.store.sauver();
    return sortie;
  }

  // ---------- Contrats (seul flux métier : un total par jour, sans donnée client) ----------

  enregistrerContrats(date, nombre) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ErreurMetier('Date invalide.');
    const n = Number(nombre);
    if (!Number.isInteger(n) || n < 0) throw new ErreurMetier('Nombre de contrats invalide.');
    const existant = this.e.contrats.find((c) => c.date === date);
    const delta = n - (existant?.nombre ?? 0);
    if (existant) existant.nombre = n;
    else this.e.contrats.push({ date, nombre: n });
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
            const enc = this.e.encouragements.filter((x) => x.sortieId === f.sortieId);
            return {
              ...base,
              sortieId: f.sortieId,
              auteur: nomAffiche(parId.get(f.userId)),
              couloir: nomCouloir[f.couloir],
              activite: ACTIVITES[f.activite].libelle,
              metres: f.metres,
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

  modifierParametres(maj) {
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
    this.verifierPaliers();
    this.store.sauver();
    return p;
  }

  rattacher(userId, couloir) {
    const u = this.e.utilisateurs.find((x) => x.id === userId);
    if (!u) throw new ErreurMetier('Collaborateur introuvable.', 404);
    if (!COULOIRS.some((c) => c.id === couloir)) throw new ErreurMetier('Couloir inconnu.');
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

  traiterHorsPlafond(sortieId, decision) {
    const s = this.e.sorties.find((x) => x.id === sortieId && x.statutPlafond === 'en_attente');
    if (!s) throw new ErreurMetier('Déclaration introuvable dans la file.', 404);
    if (decision === 'valider') s.metresComptes += s.metresEnAttente;
    else if (decision !== 'refuser') throw new ErreurMetier('Décision attendue : valider ou refuser.');
    s.metresEnAttente = 0;
    s.statutPlafond = decision === 'valider' ? 'valide' : 'refuse';
    this.verifierPaliers();
    this.store.sauver();
    return s;
  }

  importerAnnuaire(lignes) {
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
    this.store.sauver();
    // Les nouveaux arrivants sont à inviter : la liste sert à l'envoi du mail d'invitation.
    return { ajouts, aInviter: this.e.annuaire.filter((a) => !this.utilisateurParEmail(a.email)).map((a) => a.email) };
  }

  exportCsv() {
    const entete = 'date;couloir;activite;distance_m;metres_ponderes;metres_comptes;metres_en_attente;statut_plafond';
    const lignes = [...this.e.sorties]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) =>
        [s.date, s.couloir, s.activite, s.distanceMetres, s.metresPonderes, s.metresComptes, s.metresEnAttente, s.statutPlafond ?? ''].join(';'),
      );
    return [entete, ...lignes].join('\n') + '\n';
  }

  // Conservation : suppression des données personnelles 3 mois après la fin de saison.
  purgeRgpd() {
    const fin = new Date(`${this.e.parametres.saison.fin}T00:00:00Z`);
    fin.setUTCMonth(fin.getUTCMonth() + 3);
    if (this.maintenant() < fin) return { purge: false, echeance: fin.toISOString().slice(0, 10) };
    for (const u of [...this.e.utilisateurs]) this.desinscrire(u);
    this.e.annuaire = [];
    this.store.sauver();
    return { purge: true, echeance: fin.toISOString().slice(0, 10) };
  }
}

function moisPrecedent(jour) {
  const [a, m] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
