# Défi « 1 contrat = 10 mètres »

Chaque contrat signé ajoute des mètres à un compteur commun, que les collaborateurs couvrent en courant, marchant ou pédalant. Ce dépôt est le MVP décrit dans le [cahier des charges](docs/cahier-des-charges.md) : quatre écrans mobiles, un tableau de bord grand écran et un back-office minimal.

## Positionnement par rapport aux options du cahier des charges

L'implémentation se situe entre l'option A et l'option C : l'expérience des maquettes (4 écrans, SSO, fil, gamification), pour un coût d'exploitation proche de l'assemblage léger.

| Critère | Choix retenu | Conséquence |
|---|---|---|
| Dépendances | Aucune (Node.js ≥ 20, bibliothèque standard) | Revue RSSI courte, rien à patcher en cours de saison |
| Stockage | Un fichier JSON, écriture atomique | 90 personnes sur une saison : aucune base à opérer |
| Authentification | Délégation au proxy SSO de l'entreprise | Aucun mot de passe, aucun secret OIDC dans l'app |
| Strava, semaine bonus, duels, notifications | Non implémentés (V2) | Case « me prévenir » à l'inscription pour mesurer l'intérêt Strava |

## Architecture

```
src/
  config.js               Couloirs, activités, profils, paramètres par défaut
  domain/regles.js        Règles de gestion 1 à 5 (fonctions pures)
  domain/gamification.js  Série hebdomadaire, badges, affichage dans le fil
  service.js              Cas d'usage : inscription, sorties, contrats, paliers, vues, back-office, RGPD
  store.js                Persistance JSON
  server.js               API HTTP, rôles, sécurité, fichiers statiques
public/
  index.html, app.js      App mobile : inscription, accueil, déclarer, classement, fil, profil
  tableau.html            Tableau de bord Codir / open space
  admin.html              Back-office
scripts/
  import-contrats.js      Envoi quotidien de l'extraction contrats vers l'API
  purge-rgpd.js           Suppression des données personnelles à échéance
  seed-demo.js            Jeu de démonstration (90 collaborateurs)
test/                     29 tests : règles, gamification, service, HTTP
```

## Traçabilité cahier des charges → code

| Exigence | Implémentation |
|---|---|
| R1 · Mètres dus = contrats cumulés × ratio | `metresDus` |
| R2 · Pondération course ×1, marche ×1, vélo ÷3 | `metresPonderes`, aperçu instantané à la saisie |
| R3 · Classement par couloir, km/pers., jamais individuel | `classementCouloirs`. Base : effectif réel du couloir, pas les seuls inscrits. Embarquer un collègue fait progresser l'équipe |
| R4 · Paliers 25/50/75/100 % | `etatPaliers`, bannière publiée une seule fois dans le fil |
| R5 · Plafond 30 km/jour | `appliquerPlafond`. L'excédent n'est pas perdu : il part en file de validation |
| R6 · Un seul couloir | Pré-rempli depuis l'annuaire, modifiable une fois, puis par l'administrateur |
| Inscription < 60 s | Un seul écran : couloir, affichage, profil, consentement |
| Désinscription en un clic | Identité supprimée, encouragements supprimés, mètres conservés anonymisés |
| Taux d'inscription pour les référents | `GET /api/referent/inscriptions`, visible dans le profil |
| Nouvel arrivant invité | L'import annuaire renvoie la liste des personnes à inviter |
| Contrats en direct | Chaque lot quotidien publie « +X m à courir » dans le fil |
| Couloir du mois, série, badges, encouragements | `couloirDuMois`, `serieHebdomadaire`, `badgesObtenus`. Badges privés, partage au choix |
| Indicateurs de pilotage | Tableau de bord : écart, participation mensuelle vs 50 %, couloirs ≥ 1 km/pers., inscrits |
| RGPD 3 mois après la saison | `npm run purge:rgpd`, à planifier chaque jour |
| Export CSV | Sans donnée nominative |
| RGAA | Contrastes ≥ 4,5:1, cibles tactiles ≥ 44 px, focus visible, mode sombre |

## Démarrer

```bash
npm test          # 29 tests
npm run seed      # données de démonstration
npm run dev       # http://localhost:3000, connexion simulée
```

Pages : `/` app mobile, `/tableau.html` tableau de bord, `/admin.html` back-office (administrateur de démo affiché par le seed).

## Déploiement

| Variable | Rôle |
|---|---|
| `AUTH_MODE` | `proxy` (défaut) en production, `dev` pour la démo |
| `AUTH_HEADER` | En-tête posé par le proxy SSO (défaut `x-auth-request-email`) |
| `ADMIN_EMAILS` | Administrateur(s) initial(aux), séparés par des virgules |
| `INGEST_TOKEN` | Jeton de l'extraction quotidienne des contrats |
| `DASHBOARD_TOKEN` | Accès sans session pour l'écran d'open space : `/tableau.html?jeton=…` |
| `DATA_FILE`, `PORT` | Emplacement des données, port d'écoute |

Le serveur ne doit être joignable qu'à travers le proxy SSO (oauth2-proxy, Azure App Proxy ou équivalent), hébergé en UE, sans lien avec les applications de production. Seul `POST /api/ingest/contrats` reçoit un flux du SI de gestion : un total par jour, aucune donnée client.

```bash
# Chaque matin, après l'extraction (CSV « date;nombre »)
INGEST_TOKEN=… DEFI_URL=https://defi.intranet node scripts/import-contrats.js extraction.csv
```

## Point d'arbitrage : le calibrage du ratio

La démo le montre sans ambiguïté : **à 10 m par contrat, l'objectif n'est pas un défi.**

| Hypothèse | Kilomètres produits | Objectif à 10 m (200 km) atteint en |
|---|---|---|
| 45 actifs (cible 50 %), 1 sortie de 4 km par mois | 180 km / mois | ~5 semaines |
| 45 actifs, 1 sortie de 4 km par semaine | 180 km / semaine | ~8 jours |
| Seed de démo : 40 inscrits, 1 sortie tous les 25 jours | 645 km en 8 semaines | Dépassé ×3 |

Conséquences : écart positif acquis dès le premier mois, quatre paliers franchis avant la fin du trimestre, et plus aucune tension entre activité commerciale et effort collectif. L'indicateur « écart positif au 31/12 » ne discrimine plus rien.

Ratio calibré sur la cible de participation : 45 actifs × 1 sortie de 3 km toutes les deux semaines × 40 semaines ≈ 2 700 km, soit **environ 150 m par contrat** (30 km par personne sur l'année, 700 m par semaine). Le paramètre est modifiable à chaud dans le back-office ; le décider avant le lancement évite de changer la règle en cours de saison.

Le lancement tardif renforce le point : au 29 septembre, 75 % des mètres de l'année sont déjà dus. À 10 m, ce retard se comble en quelques semaines ; à 150 m, il devient un vrai départ en poursuite, à assumer ou à neutraliser (saison démarrant à la date de lancement, paramètre `saison.debut`).
