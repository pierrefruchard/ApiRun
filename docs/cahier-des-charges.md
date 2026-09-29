# Cahier des charges · Défi 1 contrat = 10 mètres

29 sept. 2026 · Pierre

## Contexte et objectifs

Chaque contrat signé ajoute 10 mètres à un compteur commun que les collaborateurs doivent couvrir en courant, marchant ou pédalant. Sur la base d'environ 20 000 contrats par an, l'objectif collectif est de 200 km, soit 2,2 km par personne pour 90 collaborateurs.

Le ratio initial de 1 m par contrat a été écarté : 222 m par personne sur un an ne crée aucune dynamique. Le ratio reste paramétrable.

| Objectif | Indicateur | Cible fin de saison |
|---|---|---|
| Relier activité commerciale et vie d'équipe | Écart mètres courus vs mètres dus | Écart positif au 31/12 |
| Embarquer largement | Participants actifs sur le mois | 50 % des effectifs |
| Décloisonner IT, gestion, CRC | Équipes ayant franchi 1 km/pers. | 6 couloirs sur 6 |
| Rester simple à opérer | Temps d'administration | Moins de 1 h par semaine |

## Périmètre, utilisateurs et règles de gestion

Le périmètre couvre les 90 collaborateurs de la direction, sur la saison civile 2026 puis reconductible. La participation est volontaire.

| Profil | Rôle dans le défi | Accès |
|---|---|---|
| Collaborateur | Déclare ses sorties, suit le compteur, encourage | App mobile |
| Référent de couloir | Anime son équipe, relaie les paliers | App mobile |
| Administrateur (1 personne) | Paramètre ratio et paliers, valide les anomalies | Back-office |
| Codir | Consulte l'avancement | Tableau de bord |

### Règles de gestion

1. Mètres dus = contrats signés cumulés depuis le 1er janvier × ratio (10 m par défaut).
2. Mètres courus = somme des distances déclarées, avec pondération : course × 1, marche × 1, vélo ÷ 3.
3. Un seul compteur collectif. Le classement se fait par couloir, en km par personne, jamais par individu.
4. Paliers à 25, 50, 75 et 100 % de l'objectif annuel, chacun associé à une récompense collective.
5. Plafond anti-abus : 30 km comptés par personne et par jour, au-delà validation par l'administrateur.
6. Rattachement d'un collaborateur à un seul couloir, selon son équipe.

Couloirs : CRC, Gestion Santé, Gestion IARD, Gestion Prévoyance, DSI · RSSI, Transformation.

## Inscription

L'inscription doit prendre moins de 60 secondes et rester ouverte toute la saison. Chaque étape supplémentaire coûte des participants.

1. Accès par lien d'invitation (mail interne) ou QR code affiché en open space.
2. Connexion avec le compte professionnel (SSO), sans création de mot de passe.
3. Couloir pré-rempli depuis l'annuaire, modifiable une fois.
4. Choix de l'affichage dans le fil : prénom, initiales ou anonyme.
5. Consentement RGPD explicite, puis connexion Strava proposée en option.
6. Profil de départ facultatif (marcheur, joggeur, coureur) qui suggère un rythme hebdomadaire indicatif.
7. Arrivée sur l'accueil avec la première sortie à déclarer mise en avant.

Règles complémentaires :

- Un nouvel arrivant dans l'entreprise reçoit l'invitation automatiquement.
- Désinscription en un clic, avec suppression immédiate des données personnelles. Les mètres déjà courus restent au compteur collectif, anonymisés.
- Le taux d'inscription par couloir est visible par les référents pour cibler l'animation.

## Gamification

Principe : le collectif gagne, l'individu progresse. Les mécaniques récompensent la régularité et l'entraide, jamais la performance brute. Celui qui marche 2 km par semaine doit avoir autant de raisons de revenir que le coureur confirmé.

| Mécanique | Déclencheur | Portée | Lot |
|---|---|---|---|
| Paliers collectifs | 25, 50, 75 et 100 % de l'objectif | Tous | MVP |
| Contrats en direct | Chaque lot de signatures publié dans le fil (« +480 m à courir ») | Tous | MVP |
| Couloir du mois | Meilleur km par personne sur le mois, trophée symbolique | Équipe | MVP |
| Série hebdomadaire | Au moins une sortie par semaine, compteur de semaines consécutives | Individu | MVP |
| Badges de régularité | Première sortie, 4 semaines d'affilée, 10 km cumulés, première sortie à vélo | Individu | MVP |
| Encouragements | Bouton dans le fil, badge « moteur » après 20 encouragements donnés | Individu | MVP |
| Semaine bonus | Mètres comptés double pendant une semaine thématique | Tous | V2 |
| Duel de couloirs | Deux couloirs tirés au sort s'affrontent sur une semaine | Équipe | V2 |
| Parrainage | Un collègue invité qui s'inscrit débloque un badge | Individu | V2 |
| Ligne d'arrivée | Les derniers kilomètres courus ensemble lors d'un événement réel | Tous | V2 |

Garde-fous :

- Aucun classement individuel, aucun badge lié à la vitesse ou à la distance maximale.
- Badges visibles par leur titulaire, partage dans le fil au choix de l'utilisateur.
- Aucune pénalité ni notification culpabilisante : une série interrompue repart simplement à zéro.
- Le plafond de 30 km par jour s'applique aussi aux semaines bonus.

## Exigences fonctionnelles

Le MVP tient en quatre écrans mobiles, un tableau de bord et un back-office minimal.

| Écran | Fonctions attendues | Lot |
|---|---|---|
| Accueil | Anneau mètres courus vs mètres dus, écart en km, contribution personnelle de la semaine, contrats signés de la semaine, prochain palier | MVP |
| Déclarer une sortie | Choix activité (course, marche, vélo), distance, date, calcul instantané des mètres comptés, confirmation | MVP |
| Déclarer une sortie | Synchronisation automatique Strava sur consentement | V2 |
| Classement | Km par personne pour les 6 couloirs, mise en avant du couloir de l'utilisateur | MVP |
| Fil de l'équipe | Sorties récentes, signatures agrégées, bannière de palier franchi, bouton encourager | MVP |
| Tableau de bord | Vue grand écran pour open space et Codir, rafraîchie chaque jour | MVP |
| Back-office | Ratio, paliers, récompenses, rattachement aux couloirs, file des déclarations hors plafond, export CSV | MVP |
| Notifications | Palier franchi, relance hebdomadaire si inactif depuis 14 jours | V2 |

Hors périmètre : classement individuel, suivi GPS en direct, données de santé (fréquence cardiaque, poids), gratification individuelle.

## Données, intégrations et exigences non fonctionnelles

Le seul flux métier est un nombre : les contrats signés par jour, agrégés, sans aucune donnée client. Tout le reste est déclaratif et volontaire.

| Donnée | Source | Fréquence | Sensibilité |
|---|---|---|---|
| Contrats signés (total du jour) | Extraction SI de gestion | Quotidienne | Interne, agrégée |
| Collaborateur (nom, couloir) | Annuaire interne | À l'inscription | Personnelle |
| Sortie (activité, distance, date) | Saisie ou Strava | À chaque sortie | Personnelle |
| Encouragements | App | Temps réel | Faible |

Exigences non fonctionnelles :

- Authentification par le compte professionnel (SSO), aucun mot de passe spécifique.
- RGPD : inscription volontaire, finalité limitée au défi, pas de donnée de santé collectée, suppression des données personnelles 3 mois après la fin de saison. Mention d'information validée par le DPO.
- Strava : accès en lecture seule aux distances et types d'activité, révocable à tout moment par l'utilisateur.
- Sécurité : hébergement UE, revue RSSI avant ouverture, aucun lien avec les applications de production.
- Usage : mobile d'abord, déclaration d'une sortie en moins de 20 secondes, accessibilité RGAA sur les contrastes et les cibles tactiles.

## Réalisation, planning et décisions

Recommandation : démarrer par l'option A pour tester l'adhésion en 3 semaines, et n'investir dans l'app qu'au vu du taux de participation.

| Option | Contenu | Délai | Effort | Limite |
|---|---|---|---|---|
| A · Assemblage léger | Club Strava privé, formulaire de saisie, tableau de bord Power BI ou page web, extraction contrats automatisée | 3 semaines | Faible, 1 profil data | Expérience fragmentée |
| B · Low-code | Application Power Apps sur les 4 écrans, SSO natif | 6 à 8 semaines | Moyen | Design contraint |
| C · App sur mesure | Web app mobile conforme aux maquettes, API Strava | 10 à 12 semaines | Élevé | Coût disproportionné pour un défi interne |

Jalons :

1. Semaine 1 : validation Codir du principe, du ratio et des récompenses.
2. Semaine 2 : avis DPO et RSSI, extraction contrats en place.
3. Semaine 3 : lancement option A, communication interne.
4. Semaine 8 : bilan de participation, décision go / no go sur B ou C.

Décisions à prendre :

- [ ] Ratio définitif (10 m recommandé)
- [ ] Nature et budget des 4 récompenses de palier
- [ ] Option de réalisation
- [ ] Administrateur désigné et référents de couloir
- [ ] Date de lancement, idéalement début de saison pour éviter un départ à 76 % de retard
