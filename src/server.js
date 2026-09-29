// Serveur HTTP sans dépendance : API JSON + fichiers statiques.
//
// Authentification : voir src/auth.js (Google IAP, Google OIDC, proxy SSO, démo).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { Service, ErreurMetier } from './service.js';
import { ACTIVITES, COULOIRS, PROFILS_DEPART } from './config.js';
import { creerAuthentification } from './auth.js';
import { configurationSi, planifierSynchronisation, synchroniserContrats } from './connecteurs/contrats-si.js';

const RACINE_PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export function creerApplication({ service, auth, authMode = 'proxy', authHeader, ingestToken, dashboardToken, connecteurSi = null }) {
  auth ??= creerAuthentification({ mode: authMode, entete: authHeader });
  authMode = auth.mode;
  const routes = [];
  const route = (methode, motif, role, gestion) => {
    const cles = [];
    const re = new RegExp(`^${motif.replace(/:(\w+)/g, (_, k) => (cles.push(k), '([^/]+)'))}$`);
    routes.push({ methode, re, cles, role, gestion });
  };

  // ----- Public / session -----
  route('GET', '/api/config', 'public', () => ({
    couloirs: COULOIRS,
    activites: ACTIVITES,
    profils: PROFILS_DEPART,
    ratioMetresParContrat: service.e.parametres.ratioMetresParContrat,
    plafondJournalierMetres: service.e.parametres.plafondJournalierMetres,
    saison: service.e.parametres.saison,
    authMode,
  }));
  route('GET', '/api/session', 'authentifie', (ctx) => service.profilSession(ctx.email));

  // ----- Inscription -----
  route('POST', '/api/inscription', 'authentifie', (ctx) => service.inscrire(ctx.email, ctx.corps));
  route('PATCH', '/api/moi', 'inscrit', (ctx) => service.modifierProfil(ctx.u, ctx.corps));
  route('DELETE', '/api/moi', 'inscrit', (ctx) => (service.desinscrire(ctx.u), { desinscrit: true }));

  // ----- Écrans collaborateur -----
  route('GET', '/api/accueil', 'inscrit', (ctx) => service.accueil(ctx.u));
  route('POST', '/api/sorties', 'inscrit', (ctx) => service.declarerSortie(ctx.u, ctx.corps));
  route('GET', '/api/classement', 'inscrit', (ctx) => service.classement(ctx.u));
  route('GET', '/api/fil', 'inscrit', (ctx) => service.fil(ctx.u));
  route('POST', '/api/sorties/:id/encourager', 'inscrit', (ctx) => service.encourager(ctx.u, ctx.params.id));
  route('POST', '/api/badges/:id/partager', 'inscrit', (ctx) => (service.partagerBadge(ctx.u, ctx.params.id), { partage: true }));

  // ----- Tableau de bord (Codir, écran open space) -----
  route('GET', '/api/tableau-de-bord', 'tableau', () => service.tableauDeBord());

  // ----- Référents -----
  route('GET', '/api/referent/inscriptions', 'referent', (ctx) =>
    service.tauxInscription(ctx.admin ? COULOIRS.map((c) => c.id) : ctx.referentDe),
  );

  // ----- Back-office : pilotage -----
  route('GET', '/api/admin/pilotage', 'admin', () => ({
    tableau: service.tableauDeBord(),
    evolution: service.evolutionHebdomadaire(),
    projection: service.projection(),
    attrition: service.attrition(),
    fileHorsPlafond: service.fileHorsPlafond().length,
  }));

  // ----- Back-office : collaborateurs -----
  route('GET', '/api/admin/collaborateurs', 'admin', () => service.listeCollaborateurs());
  route('GET', '/api/admin/collaborateurs/:id', 'admin', (ctx) => service.ficheCollaborateur(ctx.params.id, ctx.email));
  route('POST', '/api/admin/collaborateurs/:id/couloir', 'admin', (ctx) => service.rattacher(ctx.params.id, ctx.corps.couloir, ctx.email));
  route('DELETE', '/api/admin/collaborateurs/:id', 'admin', (ctx) => (service.desinscrireParAdmin(ctx.params.id, ctx.email), { desinscrit: true }));
  route('PATCH', '/api/admin/sorties/:id', 'admin', (ctx) => service.corrigerSortie(ctx.params.id, ctx.corps, ctx.email));
  route('DELETE', '/api/admin/sorties/:id', 'admin', (ctx) => (service.supprimerSortie(ctx.params.id, ctx.email), { supprime: true }));
  route('GET', '/api/admin/hors-plafond', 'admin', () => service.fileHorsPlafond());
  route('POST', '/api/admin/hors-plafond/:id', 'admin', (ctx) => service.traiterHorsPlafond(ctx.params.id, ctx.corps.decision, ctx.email));

  // ----- Back-office : contrats, paramètres, annuaire, journal -----
  route('GET', '/api/admin/contrats', 'admin', () => ({
    jours: [...service.e.contrats].sort((a, b) => b.date.localeCompare(a.date)),
    synchro: service.e.syncContrats,
    connecteurConfigure: Boolean(connecteurSi),
  }));
  route('POST', '/api/admin/contrats', 'admin', (ctx) => service.enregistrerContrats(ctx.corps.date, ctx.corps.nombre, ctx.email));
  route('POST', '/api/admin/contrats/synchroniser', 'admin', async (ctx) => {
    if (!connecteurSi) throw new ErreurMetier('Connecteur SI non configuré (SI_API_URL, SI_API_KEY).', 409);
    service.journaliser(ctx.email, 'Synchronisation contrats lancée');
    return synchroniserContrats(service, connecteurSi);
  });
  route('GET', '/api/admin/parametres', 'admin', () => service.e.parametres);
  route('PUT', '/api/admin/parametres', 'admin', (ctx) => service.modifierParametres(ctx.corps, ctx.email));
  route('POST', '/api/admin/annuaire', 'admin', (ctx) => service.importerAnnuaire(ctx.corps, ctx.email));
  route('GET', '/api/admin/journal', 'admin', () => [...service.e.journal].reverse().slice(0, 500));
  route('GET', '/api/admin/export.csv', 'admin', (ctx) => ({ __csv: service.exportCsv(ctx.email) }));

  // ----- Voie alternative (désactivée sans INGEST_TOKEN) : le SI pousse ses totaux -----
  route('POST', '/api/ingest/contrats', 'ingest', (ctx) => {
    const lignes = Array.isArray(ctx.corps) ? ctx.corps : [ctx.corps];
    return lignes.map((l) => service.enregistrerContrats(l.date, l.nombre));
  });

  function jetonValide(fourni, attendu) {
    if (!attendu || !fourni) return false;
    const a = Buffer.from(fourni);
    const b = Buffer.from(attendu);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function autoriser(role, req, url, ctx) {
    if (role === 'public') return;
    if (role === 'ingest') {
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!jetonValide(bearer, ingestToken)) throw new ErreurMetier('Jeton d’ingestion invalide.', 401);
      return;
    }
    if (role === 'tableau' && jetonValide(url.searchParams.get('jeton') ?? '', dashboardToken)) return;
    if (!ctx.email) throw new ErreurMetier('Authentification requise.', 401);
    ctx.u = service.utilisateurParEmail(ctx.email);
    ctx.admin = service.estAdministrateur(ctx.email);
    ctx.referentDe = service.couloirsReferent(ctx.email);
    if (role === 'inscrit' && !ctx.u) throw new ErreurMetier('Inscription requise.', 403);
    if (role === 'admin' && !ctx.admin) throw new ErreurMetier('Réservé à l’administrateur.', 403);
    if (role === 'referent' && !ctx.admin && ctx.referentDe.length === 0) throw new ErreurMetier('Réservé aux référents.', 403);
  }

  async function lireCorps(req) {
    const morceaux = [];
    let taille = 0;
    for await (const m of req) {
      taille += m.length;
      if (taille > 1_000_000) throw new ErreurMetier('Requête trop volumineuse.', 413);
      morceaux.push(m);
    }
    if (!morceaux.length) return {};
    try {
      return JSON.parse(Buffer.concat(morceaux).toString('utf8'));
    } catch {
      throw new ErreurMetier('JSON invalide.');
    }
  }

  function envoyer(res, statut, corps, entetes = {}) {
    res.writeHead(statut, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...entetes,
    });
    res.end(corps === undefined ? '' : JSON.stringify(corps));
  }

  async function servirStatique(res, chemin) {
    const cible = chemin === '/' ? '/index.html' : chemin.replace(/\/$/, '/index.html');
    const fichier = normalize(join(RACINE_PUBLIC, cible));
    if (!fichier.startsWith(RACINE_PUBLIC)) return envoyer(res, 404, { erreur: 'Introuvable.' });
    try {
      const contenu = await readFile(fichier);
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' });
      res.end(contenu);
    } catch {
      envoyer(res, 404, { erreur: 'Introuvable.' });
    }
  }

  return async function gestionnaire(req, res) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    const url = new URL(req.url, 'http://local');
    try {
      if (authMode === 'dev' && url.pathname === '/dev/connexion') {
        if (req.method === 'GET') {
          return envoyer(res, 200, service.e.annuaire.map(({ email, prenom, nom, couloir }) => ({ email, prenom, nom, couloir })));
        }
        const { email } = await lireCorps(req);
        return envoyer(res, 200, { ok: true }, { 'set-cookie': `dev_email=${encodeURIComponent(email ?? '')}; Path=/; HttpOnly; SameSite=Strict` });
      }

      if (auth.routes[url.pathname]) return await auth.routes[url.pathname](req, res, url);

      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return envoyer(res, 405, { erreur: 'Méthode non autorisée.' });
        return await servirStatique(res, url.pathname);
      }

      const r = routes.find((x) => x.methode === req.method && x.re.test(url.pathname));
      if (!r) return envoyer(res, 404, { erreur: 'Route inconnue.' });

      // Protection CSRF : un en-tête personnalisé impose un pré-vol CORS, refusé hors origine.
      if (req.method !== 'GET' && r.role !== 'ingest' && req.headers['x-requested-with'] !== 'defi') {
        throw new ErreurMetier('En-tête X-Requested-With manquant.', 403);
      }

      const params = Object.fromEntries(r.cles.map((k, i) => [k, decodeURIComponent(r.re.exec(url.pathname)[i + 1])]));
      const ctx = { email: await auth.identifier(req), params };
      autoriser(r.role, req, url, ctx);
      ctx.corps = req.method === 'GET' ? {} : await lireCorps(req);
      const resultat = await r.gestion(ctx);
      if (resultat && resultat.__csv !== undefined) {
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="defi-sorties.csv"',
          'cache-control': 'no-store',
        });
        return res.end(resultat.__csv);
      }
      return envoyer(res, 200, resultat ?? { ok: true });
    } catch (err) {
      if (err instanceof ErreurMetier) return envoyer(res, err.statut, { erreur: err.message });
      console.error(err);
      return envoyer(res, 500, { erreur: 'Erreur interne.' });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const store = new Store(env.DATA_FILE ?? fileURLToPath(new URL('../data/defi.json', import.meta.url)));
  const service = new Service(store);
  const admins = (env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const a of admins) if (!store.etat.parametres.administrateurs.includes(a)) store.etat.parametres.administrateurs.push(a);

  if (!env.AUTH_MODE) {
    console.error('AUTH_MODE requis : iap (Google Cloud + IAP), oidc (Google OpenID Connect), proxy ou dev.');
    process.exit(1);
  }
  const auth = creerAuthentification({
    mode: env.AUTH_MODE,
    entete: env.AUTH_HEADER,
    audience: env.IAP_AUDIENCE,
    domaine: env.GOOGLE_HD,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    urlBase: env.BASE_URL,
    secretSession: env.SESSION_SECRET,
  });
  const connecteurSi = configurationSi(env);
  if (connecteurSi) planifierSynchronisation(service, connecteurSi);

  const gestionnaire = creerApplication({
    service,
    auth,
    connecteurSi,
    ingestToken: env.INGEST_TOKEN,
    dashboardToken: env.DASHBOARD_TOKEN,
  });
  const port = Number(env.PORT ?? 3000);
  createServer(gestionnaire).listen(port, () => {
    const { ratioMetresParContrat, saison } = store.etat.parametres;
    console.log(`Défi 1 contrat = ${ratioMetresParContrat} m · saison ${saison.debut} → ${saison.fin} · http://localhost:${port}`);
    console.log(`Authentification : ${auth.mode} · connecteur SI : ${connecteurSi ? 'actif' : 'non configuré'}`);
  });
}
