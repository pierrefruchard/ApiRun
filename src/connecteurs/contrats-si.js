// Connecteur sortant vers l'API du SI de gestion : total des contrats signés par jour.
//
// L'app interroge l'API chaque jour (lecture seule, clé API en en-tête) et reprend les
// derniers jours pour absorber les régularisations. Seul un nombre transite : aucune donnée client.
//
// Configuration (variables d'environnement) :
//   SI_API_URL           URL avec le paramètre {date} (AAAA-MM-JJ), ex. https://si/api/contrats/signes?date={date}
//   SI_API_KEY           clé API fournie par l'équipe SI
//   SI_API_KEY_HEADER    en-tête portant la clé (défaut x-api-key)
//   SI_CHAMP_NOMBRE      chemin du total dans la réponse JSON (défaut total ; ex. data.nombre)
//   SI_JOURS_RATTRAPAGE  nombre de jours repris à chaque synchronisation (défaut 7)
//   SI_HEURE_SYNCHRO     heure UTC à partir de laquelle la veille est considérée complète (défaut 5)

export function configurationSi(env = process.env) {
  if (!env.SI_API_URL) return null;
  if (!env.SI_API_KEY) throw new Error('SI_API_KEY requis quand SI_API_URL est défini.');
  if (!env.SI_API_URL.includes('{date}')) throw new Error('SI_API_URL doit contenir {date}.');
  return {
    url: env.SI_API_URL,
    cle: env.SI_API_KEY,
    entete: (env.SI_API_KEY_HEADER ?? 'x-api-key').toLowerCase(),
    champ: env.SI_CHAMP_NOMBRE ?? 'total',
    joursRattrapage: Number(env.SI_JOURS_RATTRAPAGE ?? 7),
    heure: Number(env.SI_HEURE_SYNCHRO ?? 5),
  };
}

function lireChemin(objet, chemin) {
  return chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), objet);
}

function veille(jour, n = 1) {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function lireTotalJour(config, date, fetchImpl = fetch) {
  const r = await fetchImpl(config.url.replaceAll('{date}', encodeURIComponent(date)), {
    headers: { [config.entete]: config.cle, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`API SI : HTTP ${r.status} pour le ${date}`);
  const n = Number(lireChemin(await r.json(), config.champ));
  if (!Number.isInteger(n) || n < 0) throw new Error(`API SI : total invalide pour le ${date} (champ « ${config.champ} »)`);
  return n;
}

// Synchronise les jours complets (jusqu'à la veille) de la fenêtre de rattrapage, dans la saison.
export async function synchroniserContrats(service, config, { fetchImpl = fetch } = {}) {
  const jour = service.aujourdhui();
  const { debut, fin } = service.e.parametres.saison;
  const etat = { derniereTentative: service.maintenant().toISOString(), joursMisAJour: 0, erreur: null };
  try {
    for (let i = config.joursRattrapage; i >= 1; i--) {
      const date = veille(jour, i);
      if (date < debut || date > fin) continue;
      const nombre = await lireTotalJour(config, date, fetchImpl);
      const { delta } = service.enregistrerContrats(date, nombre);
      if (delta !== 0) etat.joursMisAJour += 1;
    }
    etat.dernierSucces = etat.derniereTentative;
  } catch (e) {
    etat.erreur = e.message;
    etat.dernierSucces = service.e.syncContrats?.dernierSucces ?? null;
  }
  service.e.syncContrats = etat;
  service.store.sauver();
  return etat;
}

// Planification interne : vérifie chaque heure si la synchronisation du jour a eu lieu.
export function planifierSynchronisation(service, config, { intervalleMs = 3600_000 } = {}) {
  const tick = async () => {
    const maintenant = service.maintenant();
    if (maintenant.getUTCHours() < config.heure) return;
    const dernier = service.e.syncContrats?.dernierSucces?.slice(0, 10);
    if (dernier === service.aujourdhui()) return;
    const r = await synchroniserContrats(service, config);
    if (r.erreur) console.error(`Synchronisation contrats : ${r.erreur}`);
  };
  tick();
  return setInterval(tick, intervalleMs);
}
