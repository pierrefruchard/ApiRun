// Serveur HTTP sans dépendance : API JSON + fichiers statiques.
//
// Authentification (exigence : SSO, aucun mot de passe spécifique) :
//  - AUTH_MODE=proxy (défaut) : l'application est placée derrière le proxy SSO de l'entreprise
//    (oauth2-proxy, Azure App Proxy, etc.), qui transmet l'email du compte professionnel dans
//    l'en-tête AUTH_HEADER (défaut : x-auth-request-email). Le serveur ne doit pas être exposé sans ce proxy.
//  - AUTH_MODE=dev : connexion simulée par choix dans l'annuaire, pour la démo et les tests.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { Service, ErreurMetier } from './service.js';
import { ACTIVITES, COULOIRS, PROFILS_DEPART } from './config.js';

const RACINE_PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export function creerApplication({ service, authMode = 'proxy', authHeader = 'x-auth-request-email', ingestToken, dashboardToken }) {
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

  // ----- Back-office -----
  route('GET', '/api/admin/parametres', 'admin', () => service.e.parametres);
  route('PUT', '/api/admin/parametres', 'admin', (ctx) => service.modifierParametres(ctx.corps));
  route('GET', '/api/admin/utilisateurs', 'admin', () =>
    service.e.utilisateurs.map(({ id, email, prenom, nom, couloir }) => ({ id, email, prenom, nom, couloir })),
  );
  route('POST', '/api/admin/utilisateurs/:id/couloir', 'admin', (ctx) => service.rattacher(ctx.params.id, ctx.corps.couloir));
  route('GET', '/api/admin/hors-plafond', 'admin', () => service.fileHorsPlafond());
  route('POST', '/api/admin/hors-plafond/:id', 'admin', (ctx) => service.traiterHorsPlafond(ctx.params.id, ctx.corps.decision));
  route('POST', '/api/admin/contrats', 'admin', (ctx) => service.enregistrerContrats(ctx.corps.date, ctx.corps.nombre));
  route('GET', '/api/admin/contrats', 'admin', () => [...service.e.contrats].sort((a, b) => b.date.localeCompare(a.date)));
  route('POST', '/api/admin/annuaire', 'admin', (ctx) => service.importerAnnuaire(ctx.corps));
  route('GET', '/api/admin/export.csv', 'admin', () => ({ __csv: service.exportCsv() }));

  // ----- Flux automatisé : extraction quotidienne des contrats depuis le SI de gestion -----
  route('POST', '/api/ingest/contrats', 'ingest', (ctx) => {
    const lignes = Array.isArray(ctx.corps) ? ctx.corps : [ctx.corps];
    return lignes.map((l) => service.enregistrerContrats(l.date, l.nombre));
  });

  function identifier(req) {
    if (authMode === 'dev') {
      const cookie = /(?:^|;\s*)dev_email=([^;]+)/.exec(req.headers.cookie ?? '');
      return cookie ? decodeURIComponent(cookie[1]).toLowerCase() : null;
    }
    const v = req.headers[authHeader];
    return typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null;
  }

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
      const ctx = { email: identifier(req), params };
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
  const store = new Store(process.env.DATA_FILE ?? fileURLToPath(new URL('../data/defi.json', import.meta.url)));
  const service = new Service(store);
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const a of admins) if (!store.etat.parametres.administrateurs.includes(a)) store.etat.parametres.administrateurs.push(a);
  const authMode = process.env.AUTH_MODE ?? 'proxy';
  const gestionnaire = creerApplication({
    service,
    authMode,
    authHeader: (process.env.AUTH_HEADER ?? 'x-auth-request-email').toLowerCase(),
    ingestToken: process.env.INGEST_TOKEN,
    dashboardToken: process.env.DASHBOARD_TOKEN,
  });
  const port = Number(process.env.PORT ?? 3000);
  createServer(gestionnaire).listen(port, () => {
    console.log(`Défi 1 contrat = ${store.etat.parametres.ratioMetresParContrat} m · http://localhost:${port} · auth=${authMode}`);
  });
}
