# Défi « 1 contrat = 1 mètre »

Chaque contrat signé ajoute des mètres à un compteur commun, que les collaborateurs couvrent en courant, marchant ou pédalant. Ce dépôt est le MVP décrit dans le [cahier des charges](docs/cahier-des-charges.md) : quatre écrans mobiles, un tableau de bord grand écran et une interface d'administration.

## Décisions retenues

| Sujet | Décision | Traduction dans l'app |
|---|---|---|
| Ratio | 1 m par contrat | `ratioMetresParContrat: 1`, objectif 20 km pour 20 000 contrats. Modifiable à chaud |
| Saison | Lancement le lundi 4 janvier 2027, saison test | `saison: 2027-01-04 → 2027-12-31`. Avant cette date, l'inscription est ouverte et la déclaration fermée |
| Récompenses | Paliers symboliques | Récompense vide par défaut : le palier est annoncé dans le fil, sans lot |
| Réalisation | Cette app web | Aucune dépendance, un fichier de données, un processus |
| SSO | Google, hébergement à choisir par la DSI | Deux modes prêts : Cloud Run + IAP, ou OpenID Connect Google |
| Contrats | L'app interroge l'API du SI avec une clé API | Connecteur quotidien, reprise des 7 derniers jours |
| Administrateurs | 1 titulaire + 1 suppléant | Deux champs dans les paramètres |
| Administration | Pilotage et gestion des collaborateurs | Voir ci-dessous |

Point de vigilance, noté une fois : à 1 m par contrat, l'objectif annuel (20 km pour 90 personnes) sera probablement atteint dès les premières semaines. L'écran Pilotage en donnera la mesure réelle ; le ratio peut être ajusté en cours de saison depuis Paramètres, chaque changement étant tracé au journal.

## Interface d'administration (`/admin.html`)

| Onglet | Usage |
|---|---|
| Pilotage | Écart actuel et projeté au 31/12, date estimée de chaque palier, participation du mois vs cible 50 %, graphique cumulé courus vs dus, évolution semaine par semaine, signaux d'attrition par couloir (agrégés, sans nom) |
| Collaborateurs | Recherche, filtres par couloir et statut (actif, inactif 14 j, jamais sorti). Fiche : historique des sorties, correction, suppression, changement de couloir, désinscription |
| Hors plafond | Validation ou refus de l'excédent au-delà de 30 km par jour |
| Contrats | État de la synchronisation avec le SI, relance manuelle, saisie de secours |
| Paramètres | Saison, ratio, plafond, paliers, effectifs, référents, administrateurs, import annuaire, export CSV |
| Journal | Toutes les actions d'administration, y compris chaque consultation d'un historique individuel |

Garde-fous : l'historique individuel est une donnée personnelle, sa consultation est tracée. Une désinscription anonymise aussi les entrées du journal. Le journal est purgé avec le reste, 3 mois après la fin de saison.

## Architecture

```
src/
  config.js                   Couloirs, activités, profils, paramètres par défaut (décisions)
  domain/regles.js            Règles de gestion 1 à 5 (fonctions pures)
  domain/gamification.js      Série hebdomadaire, badges, affichage dans le fil
  service.js                  Cas d'usage, pilotage, administration, journal, RGPD
  auth.js                     Google IAP, Google OIDC, proxy SSO, démo
  connecteurs/contrats-si.js  Lecture quotidienne des contrats dans l'API du SI
  store.js                    Persistance JSON, écriture atomique
  server.js                   API HTTP, rôles, sécurité, fichiers statiques
public/                       App mobile, tableau de bord, back-office
scripts/                      Démo, purge RGPD, import CSV de secours
test/                         47 tests
```

## Démarrer

```bash
npm test          # 47 tests
npm run seed      # démo : 90 collaborateurs, saison rejouée sur 2026
npm run dev       # http://localhost:3000, connexion simulée
```

Pages : `/` app mobile, `/tableau.html` tableau de bord, `/admin.html` back-office. Le seed affiche les deux administrateurs de démo.

## Déploiement

### Authentification Google (au choix de la DSI)

| Variable | `AUTH_MODE=iap` · Cloud Run + IAP | `AUTH_MODE=oidc` · connexion gérée par l'app |
|---|---|---|
| Principe | IAP authentifie, l'app vérifie la signature de `x-goog-iap-jwt-assertion` | Flux OpenID Connect Google, session en cookie signé |
| Obligatoire | `IAP_AUDIENCE` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`, `SESSION_SECRET` (≥ 32 caractères) |
| Recommandé | `GOOGLE_HD` (domaine Workspace) | `GOOGLE_HD` (domaine Workspace) |
| Secret dans l'app | Aucun | Secret client OAuth |

Recommandation : IAP, région `europe-west9` (Paris). Cela répond à l'exigence d'hébergement UE et ne met aucun secret OAuth dans l'app. Seules les personnes présentes dans l'annuaire importé peuvent s'inscrire.

### Connecteur contrats (API du SI)

| Variable | Rôle |
|---|---|
| `SI_API_URL` | URL contenant `{date}`, par ex. `https://si.interne/api/contrats/signes?date={date}` |
| `SI_API_KEY` | Clé API fournie par l'équipe SI |
| `SI_API_KEY_HEADER` | En-tête portant la clé (défaut `x-api-key`) |
| `SI_CHAMP_NOMBRE` | Chemin du total dans la réponse JSON (défaut `total`, ex. `data.nombre`) |
| `SI_JOURS_RATTRAPAGE` | Jours repris à chaque passage (défaut 7) |
| `SI_HEURE_SYNCHRO` | Heure UTC à partir de laquelle la veille est lue (défaut 5) |

Le connecteur ne lit qu'un total par jour : aucune donnée client ne transite. Ce lien sortant vers le SI de gestion est à présenter en revue RSSI, puisque le cahier des charges exclut tout lien avec les applications de production. Un accès en lecture seule, restreint à ce seul point de terminaison, limite l'exposition.

### Autres variables

| Variable | Rôle |
|---|---|
| `ADMIN_EMAILS` | Administrateurs initiaux (titulaire, suppléant) |
| `DASHBOARD_TOKEN` | Écran d'open space sans session : `/tableau.html?jeton=…` |
| `DATA_FILE`, `PORT` | Emplacement des données, port |
| `INGEST_TOKEN` | Voie alternative où le SI pousse ses totaux. Désactivée si absente |

Tâche planifiée : `npm run purge:rgpd` chaque jour. Elle reste sans effet avant le 31 mars 2028.

## Traçabilité cahier des charges → code

| Exigence | Implémentation |
|---|---|
| R1 · Mètres dus = contrats cumulés × ratio | `metresDus` |
| R2 · Pondération course ×1, marche ×1, vélo ÷3 | `metresPonderes`, aperçu instantané à la saisie |
| R3 · Classement par couloir, km/pers., jamais individuel | `classementCouloirs`, sur l'effectif réel du couloir |
| R4 · Paliers 25/50/75/100 % | `etatPaliers`, bannière publiée une seule fois |
| R5 · Plafond 30 km/jour | `appliquerPlafond`, excédent en file de validation |
| R6 · Un seul couloir | Pré-rempli depuis l'annuaire, modifiable une fois, puis par l'administrateur |
| Inscription < 60 s, désinscription en un clic | Un écran ; identité supprimée, mètres conservés anonymisés |
| Gamification MVP | Série, badges privés partageables, encouragements, couloir du mois, contrats en direct |
| Indicateurs de pilotage | Tableau de bord et onglet Pilotage |
| RGPD, RGAA | Purge à échéance, export sans nom ; contrastes, cibles ≥ 44 px, focus visible, mode sombre |
