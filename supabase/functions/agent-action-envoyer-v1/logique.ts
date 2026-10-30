// supabase/functions/agent-action-envoyer-v1/logique.ts
// ─────────────────────────────────────────────────────────────────────────────
// Envoi d'une action externe VALIDÉE par l'utilisateur (agent_actions_externes).
// Logique pure + dépendances injectées (testable sans réseau ni base).
//
// Garanties :
//   · seul le propriétaire (auth.uid() = user_id) peut déclencher l'envoi ;
//   · seul le statut `valide` part ; `envoye` ne repart JAMAIS (réponse idempotente) ;
//   · double clic / requêtes concurrentes : verrou par compare-and-swap sur la
//     colonne `erreur` (« envoi_en_cours:<horodatage> », périmé après 5 min) ;
//   · e-mail : uniquement via la boîte connectée DE L'UTILISATEUR ; sans boîte →
//     { ok:false, raison:'boite_non_connectee', repli } et le statut reste `valide` ;
//   · courrier : PDF déposé dans le bucket privé, URL signée renvoyée, pas d'envoi postal.
// ─────────────────────────────────────────────────────────────────────────────

export interface Destinataire {
  nom?: string; qualite?: string; email?: string; adresse?: string;
}
export interface PieceJointe { type: string; bucket?: string; chemin?: string; cree_le?: string }
export interface ActionExterne {
  id: string; user_id: string; canal: 'email' | 'courrier'; destinataire: Destinataire | null;
  objet: string | null; corps: string | null; pieces: PieceJointe[] | null;
  statut: 'brouillon' | 'valide' | 'envoye' | 'refuse' | 'echec'; erreur: string | null;
}

/** Boîte d'envoi de l'utilisateur (aujourd'hui : aucune source par utilisateur, voir index.ts). */
export interface BoiteMail { fournisseur: 'google'; adresse: string; accessToken: string }

export interface DepotActions {
  utilisateurDepuisJwt(jwt: string): Promise<string | null>;
  lireAction(id: string, userId: string): Promise<ActionExterne | null>;
  /** CAS : pose `nouveau` dans `erreur` si statut='valide' ET erreur = `ancien` (null = vide). */
  poserVerrou(id: string, ancien: string | null, nouveau: string): Promise<boolean>;
  libererVerrou(id: string, verrou: string): Promise<void>;
  /** CAS depuis le verrou : remplace `erreur` par le marqueur « résultat inconnu » (statut reste `valide`). */
  marquerIncertain(id: string, verrou: string, marqueur: string): Promise<void>;
  /** Passe `envoye` (seulement depuis `valide`) ; renvoie false si la ligne n'était plus `valide`.
   *  Les pièces ne sont PAS modifiées : le déclencheur fige le texte et les pièces dès la validation ;
   *  le PDF est retrouvé par son chemin déterministe (cheminCourrier). */
  marquerEnvoye(id: string): Promise<boolean>;
  marquerEchec(id: string, erreur: string): Promise<void>;
  nomExpediteur(userId: string): Promise<string | null>;
  boiteMail(userId: string): Promise<BoiteMail | null>;
  deposerPdf(chemin: string, octets: Uint8Array): Promise<void>;
  urlSignee(chemin: string, secondes: number): Promise<string | null>;
}

export interface Dependances {
  depot: DepotActions;
  envoyerEmail: (boite: BoiteMail, m: { a: string; objet: string; corps: string }) => Promise<{ id?: string }>;
  genererPdf: (c: { expediteur: { nom: string }; destinataire: { nom: string; adresse?: string }; objet: string; corps: string; date: Date }) => Promise<Uint8Array>;
  maintenant?: () => Date;
}

export const BUCKET_COURRIERS = 'agent-courriers';
export const DUREE_URL_S = 3600;
export const VERROU_PERIME_MS = 5 * 60_000;
const PREFIXE_VERROU = 'envoi_en_cours:';
const PREFIXE_INCERTAIN = 'envoi_incertain:';

/**
 * Erreur dont on ne sait pas si l'envoi a eu lieu (coupure réseau, délai dépassé,
 * erreur 5xx du fournisseur, réponse illisible). À l'inverse, une erreur ordinaire
 * (refus 4xx explicite, adresse invalide…) est un ÉCHEC CERTAIN : rien n'est parti.
 */
export class EnvoiIncertain extends Error {
  constructor(message: string) { super(message); this.name = 'EnvoiIncertain'; }
}

export const MESSAGE_INCERTAIN =
  "L'envoi a peut-être eu lieu, mais la confirmation n'est pas arrivée. Vérifiez le dossier « Envoyés » " +
  "de votre messagerie avant toute nouvelle tentative. Pour éviter un doublon, cette action ne repartira pas " +
  'automatiquement : si le message n\'est pas parti, refusez-la et faites rédiger un nouveau brouillon.';

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reponse(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;

export function emailValide(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && RE_EMAIL.test(v.trim());
}

/** Lien mailto: de repli (le front l'ouvre dans la messagerie de l'utilisateur). */
export function lienMailto(a: string, objet: string, corps: string): string {
  return `mailto:${encodeURIComponent(a)}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`;
}

/** État du verrou porté par `erreur` : envoi en cours (frais), résultat inconnu (définitif), ou libre. */
export function etatVerrou(erreur: string | null, now: Date): 'en_cours' | 'incertain' | null {
  if (!erreur) return null;
  if (erreur.startsWith(PREFIXE_INCERTAIN)) return 'incertain';
  if (!erreur.startsWith(PREFIXE_VERROU)) return null;
  const t = Date.parse(erreur.slice(PREFIXE_VERROU.length));
  return Number.isFinite(t) && now.getTime() - t < VERROU_PERIME_MS ? 'en_cours' : null;
}
export const verrouActif = (erreur: string | null, now: Date) => etatVerrou(erreur, now) !== null;

export function cheminCourrier(userId: string, actionId: string): string {
  return `${userId}/${actionId}.pdf`;
}

export async function traiterEnvoi(req: Request, deps: Dependances): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reponse({ ok: false, raison: 'methode' }, 405);
  const now = (deps.maintenant ?? (() => new Date()))();
  const { depot } = deps;

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const uid = jwt ? await depot.utilisateurDepuisJwt(jwt) : null;
  if (!uid) return reponse({ ok: false, raison: 'non_authentifie' }, 401);

  let actionId: unknown;
  try { actionId = ((await req.json()) as { action_id?: unknown })?.action_id; } catch { /* corps invalide */ }
  if (typeof actionId !== 'string' || !RE_UUID.test(actionId)) return reponse({ ok: false, raison: 'action_id_invalide' }, 400);

  const action = await depot.lireAction(actionId, uid);
  if (!action || action.user_id !== uid) return reponse({ ok: false, raison: 'introuvable' }, 404);

  // Idempotence : une action envoyée ne repart jamais.
  if (action.statut === 'envoye') {
    if (action.canal === 'courrier') {
      const url = await depot.urlSignee(cheminCourrier(uid, action.id), DUREE_URL_S);
      return reponse({ ok: true, deja_envoye: true, canal: 'courrier', url, expire_dans_s: url ? DUREE_URL_S : null });
    }
    return reponse({ ok: true, deja_envoye: true, canal: 'email' });
  }
  if (action.statut !== 'valide') return reponse({ ok: false, raison: 'non_valide', statut: action.statut }, 409);

  // Verrou anti double envoi ; un résultat inconnu bloque définitivement le renvoi automatique.
  const etat = etatVerrou(action.erreur, now);
  if (etat === 'incertain') return reponse({ ok: false, raison: 'resultat_inconnu', message: MESSAGE_INCERTAIN }, 409);
  if (etat === 'en_cours') return reponse({ ok: false, raison: 'envoi_en_cours' }, 409);
  const verrou = `${PREFIXE_VERROU}${now.toISOString()}`;
  if (!(await depot.poserVerrou(action.id, action.erreur, verrou))) return reponse({ ok: false, raison: 'envoi_en_cours' }, 409);

  const objet = (action.objet ?? '').trim();
  const corps = (action.corps ?? '').trim();
  const dest = action.destinataire ?? {};
  if (!objet || !corps) {
    await depot.libererVerrou(action.id, verrou);
    return reponse({ ok: false, raison: 'contenu_vide' }, 422);
  }

  if (action.canal === 'email') {
    const a = (dest.email ?? '').trim();
    if (!emailValide(a)) {
      await depot.libererVerrou(action.id, verrou);
      return reponse({ ok: false, raison: 'email_destinataire_invalide' }, 422);
    }
    const boite = await depot.boiteMail(uid);
    if (!boite) {
      await depot.libererVerrou(action.id, verrou);
      return reponse({ ok: false, raison: 'boite_non_connectee', repli: { a, objet, corps, mailto: lienMailto(a, objet, corps) } });
    }
    let r: { id?: string };
    try {
      r = await deps.envoyerEmail(boite, { a, objet, corps });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (e instanceof EnvoiIncertain) {
        // Le message est peut-être parti : l'action reste bloquée (statut `valide`, marqueur
        // permanent dans `erreur`) au lieu de passer en `echec`, qui permettrait de la revalider.
        await depot.marquerIncertain(action.id, verrou, `${PREFIXE_INCERTAIN}${now.toISOString()} ${msg}`);
        return reponse({ ok: false, raison: 'resultat_inconnu', message: MESSAGE_INCERTAIN, detail: msg }, 502);
      }
      await depot.marquerEchec(action.id, msg); // échec certain : rien n'est parti, revalidable
      return reponse({ ok: false, raison: 'echec_envoi', message: msg }, 502);
    }
    // Parti avec certitude : si l'écriture du statut échoue, on bloque quand même tout renvoi.
    let marque = false;
    try { marque = await depot.marquerEnvoye(action.id); } catch { marque = false; }
    if (!marque) {
      await depot.marquerIncertain(action.id, verrou, `${PREFIXE_INCERTAIN}${now.toISOString()} envoyé mais statut non enregistré`).catch(() => {});
      console.error('[agent-action-envoyer] e-mail parti mais statut non enregistré', action.id);
    }
    return reponse({ ok: true, canal: 'email', de: boite.adresse, a, fournisseur_id: r.id ?? null });
  }

  if (action.canal === 'courrier') {
    // Aucun effet extérieur (pas d'envoi postal) : une erreur ici est un échec certain.
    const nomDest = (dest.nom ?? '').trim();
    if (!nomDest) {
      await depot.libererVerrou(action.id, verrou);
      return reponse({ ok: false, raison: 'destinataire_incomplet' }, 422);
    }
    try {
      const nomExp = (await depot.nomExpediteur(uid))?.trim();
      if (!nomExp) {
        await depot.libererVerrou(action.id, verrou);
        return reponse({ ok: false, raison: 'profil_incomplet', message: 'Renseignez votre nom dans votre profil pour signer le courrier.' }, 422);
      }
      const octets = await deps.genererPdf({
        expediteur: { nom: nomExp }, destinataire: { nom: nomDest, adresse: dest.adresse }, objet, corps, date: now,
      });
      const chemin = cheminCourrier(uid, action.id);
      await depot.deposerPdf(chemin, octets);
      if (!(await depot.marquerEnvoye(action.id))) {
        return reponse({ ok: false, raison: 'etat_concurrent' }, 409);
      }
      const url = await depot.urlSignee(chemin, DUREE_URL_S);
      return reponse({ ok: true, canal: 'courrier', url, expire_dans_s: url ? DUREE_URL_S : null, chemin });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await depot.marquerEchec(action.id, msg);
      return reponse({ ok: false, raison: 'echec_courrier', message: msg }, 500);
    }
  }

  await depot.libererVerrou(action.id, verrou);
  return reponse({ ok: false, raison: 'canal_inconnu' }, 422);
}

// ── Gmail (API REST users.messages.send) ─────────────────────────────────────

function b64(s: string): string {
  const octets = new TextEncoder().encode(s);
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin);
}
const sansRetour = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** Message MIME texte UTF-8 (en-têtes protégés contre l'injection CR/LF). */
export function construireMime(de: string, a: string, objet: string, corps: string): string {
  if (!emailValide(de) || !emailValide(a)) throw new Error('Adresse e-mail invalide.');
  const corps64 = b64(corps.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${sansRetour(de)}`,
    `To: ${sansRetour(a)}`,
    `Subject: =?UTF-8?B?${b64(sansRetour(objet))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    corps64,
  ].join('\r\n');
}

export async function envoyerViaGmail(
  boite: BoiteMail, m: { a: string; objet: string; corps: string }, f: typeof fetch = fetch,
): Promise<{ id?: string }> {
  const raw = b64(construireMime(boite.adresse, m.a, m.objet, m.corps)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let r: Response;
  try {
    r = await f('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${boite.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    // Coupure ou délai dépassé : la requête a pu être reçue et traitée.
    throw new EnvoiIncertain(`Gmail injoignable : ${e instanceof Error ? e.message : String(e)}`);
  }
  const j = await r.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
  if (r.status >= 500) throw new EnvoiIncertain(`Gmail ${r.status} : ${j?.error?.message ?? 'erreur du serveur'}`);
  if (!r.ok) throw new Error(`Gmail ${r.status} : ${j?.error?.message ?? 'envoi refusé'}`); // 4xx : refus certain
  return { id: j?.id };
}
