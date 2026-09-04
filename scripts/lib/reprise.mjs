// scripts/lib/reprise.mjs
//
// Reprise sur erreur réseau transitoire, pour les scripts d'import.
//
// Un import découpe son travail en centaines d'appels réseau — 243 lots pour
// les seuls plafonds Loc'Avantages, plusieurs milliers pour le cadastre. À
// cette échelle, une coupure n'est pas un aléa : c'est une certitude. Sans
// reprise, elle fait échouer tout l'import à mi-parcours.
//
// Ce module ne rejoue QUE les erreurs transitoires. Une contrainte violée, un
// droit manquant ou un schéma incohérent doivent échouer immédiatement : les
// rejouer masquerait un vrai défaut derrière cinq minutes d'attente.

/**
 * Les échecs réseau remontent sous des formes très différentes selon la couche
 * qui les a vus — `fetch` d'undici enveloppe le code système dans `cause`, et
 * supabase-js reconditionne le tout en objet `error` sans lever d'exception.
 * On inspecte donc le message, la cause et le code.
 */
const MOTIFS_TRANSITOIRES = [
  "fetch failed",
  "socket hang up",
  "network",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
];

/** Codes HTTP qu'il est légitime de rejouer : surcharge et pannes passagères. */
const STATUTS_TRANSITOIRES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function estTransitoire(erreur) {
  if (!erreur) return false;

  const statut = Number(erreur.status ?? erreur.statusCode);
  if (Number.isFinite(statut) && STATUTS_TRANSITOIRES.has(statut)) return true;

  const texte = [
    erreur.message,
    erreur.code,
    erreur.cause?.message,
    erreur.cause?.code,
  ]
    .filter(Boolean)
    .join(" ");

  return MOTIFS_TRANSITOIRES.some((motif) => texte.includes(motif));
}

const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Rejoue `operation` tant qu'elle échoue de façon transitoire.
 *
 * Gère les deux conventions d'erreur croisées dans ces scripts :
 *  • l'exception levée — `fetch`, les flux ;
 *  • l'objet `{ error }` renvoyé sans lever — supabase-js.
 *
 * L'attente double à chaque tentative (1 s, 2 s, 4 s…), avec une part aléatoire
 * pour éviter que plusieurs lots repartent en même temps après une coupure.
 *
 * @param {() => Promise<any>} operation
 * @param {{ tentatives?: number, attenteInitiale?: number, surEchec?: Function }} options
 */
export async function avecReprise(operation, options = {}) {
  const { tentatives = 5, attenteInitiale = 1000, surEchec } = options;

  let attente = attenteInitiale;

  for (let n = 1; ; n += 1) {
    const derniere = n >= tentatives;
    let resultat;

    try {
      resultat = await operation();
    } catch (e) {
      if (derniere || !estTransitoire(e)) throw e;
      surEchec?.({ tentative: n, tentatives, attente, erreur: e });
      await patienter(attente + Math.random() * 250);
      attente *= 2;
      continue;
    }

    // Convention supabase-js : pas d'exception, une erreur dans le résultat.
    if (resultat?.error && !derniere && estTransitoire(resultat.error)) {
      surEchec?.({ tentative: n, tentatives, attente, erreur: resultat.error });
      await patienter(attente + Math.random() * 250);
      attente *= 2;
      continue;
    }

    return resultat;
  }
}

/** Trace lisible d'une reprise, à passer en `surEchec`. */
export function tracerReprise({ tentative, tentatives, attente, erreur }) {
  process.stdout.write(
    `\n  ⚠ ${erreur.message ?? erreur} — reprise ${tentative}/${tentatives - 1} ` +
      `dans ${(attente / 1000).toFixed(0)} s\n`,
  );
}
