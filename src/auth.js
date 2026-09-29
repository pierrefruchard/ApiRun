// Authentification par le compte professionnel Google. Aucun mot de passe propre à l'app.
//
// Le mode est un choix d'hébergement laissé à la DSI :
//  - iap   : Google Cloud Run (ou GCE) derrière Identity-Aware Proxy. L'app vérifie la signature
//            de l'assertion IAP (x-goog-iap-jwt-assertion). Aucun secret OAuth dans l'app.
//  - oidc  : l'app gère elle-même la connexion Google (OpenID Connect, flux « authorization code »).
//            Session dans un cookie signé HMAC. Domaine Workspace imposé (GOOGLE_HD).
//  - proxy : tout autre proxy SSO qui transmet l'email dans un en-tête de confiance.
//  - dev   : connexion simulée par choix dans l'annuaire, pour la démo et les tests.

import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

const IAP_JWKS = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const IAP_ISS = 'https://cloud.google.com/iap';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISS = ['https://accounts.google.com', 'accounts.google.com'];
const DUREE_SESSION_S = 12 * 3600;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function lireCookie(req, nom) {
  const m = new RegExp(`(?:^|;\\s*)${nom}=([^;]+)`).exec(req.headers.cookie ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- Vérification de JWT (ES256 pour IAP, RS256 pour Google) ----------

export function creerCacheJwks(url, fetchImpl = fetch, dureeMs = 3600_000) {
  let cache = null;
  let expire = 0;
  return async () => {
    if (!cache || Date.now() > expire) {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`JWKS indisponible (${r.status})`);
      cache = (await r.json()).keys;
      expire = Date.now() + dureeMs;
    }
    return cache;
  };
}

export async function verifierJwt(jeton, { cles, audience, emetteurs, maintenant = () => Date.now() }) {
  const parts = String(jeton ?? '').split('.');
  if (parts.length !== 3) throw new Error('JWT mal formé');
  const [h64, p64, s64] = parts;
  const entete = JSON.parse(Buffer.from(h64, 'base64url').toString('utf8'));
  const charge = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
  const algos = { ES256: { dsaEncoding: 'ieee-p1363' }, RS256: {} };
  if (!algos[entete.alg]) throw new Error(`Algorithme refusé : ${entete.alg}`);
  const jwk = (await cles()).find((k) => k.kid === entete.kid);
  if (!jwk) throw new Error('Clé de signature inconnue');
  const ok = verify(
    'sha256',
    Buffer.from(`${h64}.${p64}`),
    { key: createPublicKey({ key: jwk, format: 'jwk' }), ...algos[entete.alg] },
    Buffer.from(s64, 'base64url'),
  );
  if (!ok) throw new Error('Signature invalide');
  const t = Math.floor(maintenant() / 1000);
  if (typeof charge.exp !== 'number' || charge.exp < t - 30) throw new Error('Jeton expiré');
  if (typeof charge.iat === 'number' && charge.iat > t + 30) throw new Error('Jeton émis dans le futur');
  const auds = Array.isArray(charge.aud) ? charge.aud : [charge.aud];
  if (!auds.includes(audience)) throw new Error('Audience invalide');
  if (!emetteurs.includes(charge.iss)) throw new Error('Émetteur invalide');
  return charge;
}

// ---------- Session signée (mode oidc) ----------

export function signerSession(email, secret, maintenant = Date.now()) {
  const charge = b64url(JSON.stringify({ email, exp: Math.floor(maintenant / 1000) + DUREE_SESSION_S }));
  return `${charge}.${b64url(createHmac('sha256', secret).update(charge).digest())}`;
}

export function lireSession(valeur, secret, maintenant = Date.now()) {
  const [charge, sig] = String(valeur ?? '').split('.');
  if (!charge || !sig) return null;
  const attendu = createHmac('sha256', secret).update(charge).digest();
  const fourni = Buffer.from(sig, 'base64url');
  if (fourni.length !== attendu.length || !timingSafeEqual(fourni, attendu)) return null;
  const { email, exp } = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  return exp > maintenant / 1000 ? email : null;
}

// ---------- Fabrique ----------

export function creerAuthentification(options) {
  const { mode } = options;
  switch (mode) {
    case 'dev':
      return {
        mode,
        identifier: async (req) => lireCookie(req, 'dev_email')?.toLowerCase() ?? null,
        routes: {},
      };
    case 'proxy': {
      const entete = (options.entete ?? 'x-auth-request-email').toLowerCase();
      return {
        mode,
        identifier: async (req) => {
          const v = req.headers[entete];
          return typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null;
        },
        routes: {},
      };
    }
    case 'iap':
      return authIap(options);
    case 'oidc':
      return authOidc(options);
    default:
      throw new Error(`AUTH_MODE inconnu : ${mode}`);
  }
}

function controlerDomaine(email, domaine) {
  if (domaine && !email.endsWith(`@${domaine.toLowerCase()}`)) throw new Error('Domaine non autorisé');
  return email;
}

function authIap({ audience, domaine, fetchImpl = fetch, maintenant }) {
  if (!audience) throw new Error('IAP_AUDIENCE requis (format /projects/NUM/locations/REGION/services/SERVICE ou /projects/NUM/global/backendServices/ID).');
  const cles = creerCacheJwks(IAP_JWKS, fetchImpl);
  return {
    mode: 'iap',
    identifier: async (req) => {
      const jeton = req.headers['x-goog-iap-jwt-assertion'];
      if (!jeton) return null;
      try {
        const c = await verifierJwt(jeton, { cles, audience, emetteurs: [IAP_ISS], maintenant });
        return controlerDomaine(String(c.email).toLowerCase(), domaine);
      } catch (e) {
        console.warn(`IAP : ${e.message}`);
        return null;
      }
    },
    routes: {},
  };
}

function authOidc({ clientId, clientSecret, urlBase, domaine, secretSession, fetchImpl = fetch, maintenant }) {
  for (const [k, v] of Object.entries({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, BASE_URL: urlBase, SESSION_SECRET: secretSession })) {
    if (!v) throw new Error(`${k} requis en mode oidc.`);
  }
  if (secretSession.length < 32) throw new Error('SESSION_SECRET doit faire au moins 32 caractères.');
  const cles = creerCacheJwks(GOOGLE_JWKS, fetchImpl);
  const retour = `${urlBase.replace(/\/$/, '')}/auth/retour`;
  const securise = urlBase.startsWith('https://') ? '; Secure' : '';

  const redirection = (res, lieu, cookies = []) => {
    res.writeHead(302, { location: lieu, 'set-cookie': cookies, 'cache-control': 'no-store' });
    res.end();
  };

  return {
    mode: 'oidc',
    identifier: async (req) => lireSession(lireCookie(req, 'defi_session'), secretSession),
    routes: {
      '/auth/connexion': async (req, res) => {
        const etat = b64url(randomBytes(24));
        const nonce = b64url(randomBytes(24));
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: retour,
          response_type: 'code',
          scope: 'openid email profile',
          state: etat,
          nonce,
          prompt: 'select_account',
          ...(domaine ? { hd: domaine } : {}),
        });
        redirection(res, `${GOOGLE_AUTH}?${params}`, [
          `defi_oidc=${etat}.${nonce}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${securise}`,
        ]);
      },
      '/auth/retour': async (req, res, url) => {
        const [etat, nonce] = (lireCookie(req, 'defi_oidc') ?? '').split('.');
        const effacer = `defi_oidc=; Path=/auth; Max-Age=0${securise}`;
        try {
          if (!etat || url.searchParams.get('state') !== etat) throw new Error('État OIDC invalide');
          const code = url.searchParams.get('code');
          if (!code) throw new Error(url.searchParams.get('error') ?? 'Code absent');
          const r = await fetchImpl(GOOGLE_TOKEN, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: retour, grant_type: 'authorization_code' }),
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) throw new Error(`Échange du code refusé (${r.status})`);
          const { id_token: idToken } = await r.json();
          const c = await verifierJwt(idToken, { cles, audience: clientId, emetteurs: GOOGLE_ISS, maintenant });
          if (c.nonce !== nonce) throw new Error('Nonce invalide');
          if (c.email_verified !== true) throw new Error('Email non vérifié');
          if (domaine && c.hd !== domaine) throw new Error('Compte hors du domaine de l’entreprise');
          const email = String(c.email).toLowerCase();
          redirection(res, '/', [effacer, `defi_session=${signerSession(email, secretSession)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DUREE_SESSION_S}${securise}`]);
        } catch (e) {
          console.warn(`OIDC : ${e.message}`);
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': [effacer] });
          res.end('Connexion refusée. Utilise ton compte professionnel Google.');
        }
      },
      '/auth/deconnexion': async (req, res) => {
        redirection(res, '/', [`defi_session=; Path=/; Max-Age=0${securise}`]);
      },
    },
  };
}
