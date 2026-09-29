import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { creerAuthentification, lireSession, signerSession, verifierJwt } from '../src/auth.js';

function fabriquer(alg) {
  const { privateKey, publicKey } = alg === 'ES256'
    ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
  const emettre = (charge) => {
    const h = Buffer.from(JSON.stringify({ alg, kid: 'k1' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(charge)).toString('base64url');
    const opts = alg === 'ES256' ? { key: privateKey, dsaEncoding: 'ieee-p1363' } : privateKey;
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), opts).toString('base64url')}`;
  };
  return { cles: async () => [jwk], emettre };
}

const t = Math.floor(Date.now() / 1000);

test('JWT IAP (ES256) : signature, audience, émetteur, expiration', async () => {
  const { cles, emettre } = fabriquer('ES256');
  const ok = { iss: 'https://cloud.google.com/iap', aud: '/projects/1/x', exp: t + 600, iat: t, email: 'lea@ex.fr' };
  const opts = { cles, audience: '/projects/1/x', emetteurs: ['https://cloud.google.com/iap'] };
  assert.equal((await verifierJwt(emettre(ok), opts)).email, 'lea@ex.fr');
  await assert.rejects(verifierJwt(emettre({ ...ok, aud: 'autre' }), opts), /Audience/);
  await assert.rejects(verifierJwt(emettre({ ...ok, exp: t - 3600 }), opts), /expiré/);
  await assert.rejects(verifierJwt(emettre({ ...ok, iss: 'x' }), opts), /Émetteur/);
  const falsifie = emettre(ok).split('.');
  falsifie[1] = Buffer.from(JSON.stringify({ ...ok, email: 'pirate@ex.fr' })).toString('base64url');
  await assert.rejects(verifierJwt(falsifie.join('.'), opts), /Signature/);
});

test('JWT Google (RS256) et refus de l’algorithme none', async () => {
  const { cles, emettre } = fabriquer('RS256');
  const opts = { cles, audience: 'client', emetteurs: ['https://accounts.google.com'] };
  const c = await verifierJwt(emettre({ iss: 'https://accounts.google.com', aud: 'client', exp: t + 60, email: 'a@b.fr' }), opts);
  assert.equal(c.email, 'a@b.fr');
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`;
  await assert.rejects(verifierJwt(none, opts), /Algorithme/);
});

test('session signée : lecture, falsification, expiration', () => {
  const secret = 'x'.repeat(32);
  const v = signerSession('lea@ex.fr', secret);
  assert.equal(lireSession(v, secret), 'lea@ex.fr');
  assert.equal(lireSession(v, 'y'.repeat(32)), null);
  assert.equal(lireSession(`${v.split('.')[0]}x.${v.split('.')[1]}`, secret), null);
  assert.equal(lireSession(signerSession('lea@ex.fr', secret, Date.now() - 13 * 3600_000), secret), null);
});

test('configuration : modes inconnus et secrets manquants refusés', () => {
  assert.throws(() => creerAuthentification({ mode: 'magie' }), /inconnu/);
  assert.throws(() => creerAuthentification({ mode: 'iap' }), /IAP_AUDIENCE/);
  assert.throws(() => creerAuthentification({ mode: 'oidc', clientId: 'c', clientSecret: 's', urlBase: 'https://x', secretSession: 'court' }), /32/);
});

test('mode oidc : redirection vers Google avec domaine imposé', async () => {
  const a = creerAuthentification({ mode: 'oidc', clientId: 'c', clientSecret: 's', urlBase: 'https://defi.ex.fr', secretSession: 'z'.repeat(32), domaine: 'ex.fr' });
  let statut;
  let entetes;
  await a.routes['/auth/connexion']({}, { writeHead: (s, h) => ((statut = s), (entetes = h)), end() {} });
  assert.equal(statut, 302);
  const u = new URL(entetes.location);
  assert.equal(u.hostname, 'accounts.google.com');
  assert.equal(u.searchParams.get('hd'), 'ex.fr');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://defi.ex.fr/auth/retour');
  assert.match(entetes['set-cookie'][0], /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
});
