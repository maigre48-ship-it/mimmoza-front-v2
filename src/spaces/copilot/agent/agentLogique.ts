// src/spaces/copilot/agent/agentLogique.ts
// =============================================================================
// Logique PURE de l'agent autonome côté interface : lecture prudente des
// données serveur, libellés, calculs de progression et de devis.
// Aucune dépendance (ni React, ni Supabase) : testée par agentLogique.test.ts
// avec `node --test` (npm test).
// =============================================================================

import type {
  ActionExterne, Briefing, DevisMission, ElementBriefing, ElementMemoire,
  LigneJournal, Mission, PropositionDevis, RapportMission, TerrainRapport,
} from './agent.types';

// ── Petits lecteurs tolérants ────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const nombre = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const entier = (v: unknown, defaut = 0): number => {
  const n = nombre(v);
  return n == null ? defaut : Math.round(n);
};
const listeTextes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : texte((x as Obj)?.titre) ?? texte((x as Obj)?.label) ?? '')).filter(Boolean) : [];

/** Une sortie d'outil peut être un objet, un objet `{data: …}` ou du JSON en texte. */
function deballer(v: unknown): Obj | null {
  let x: unknown = v;
  if (typeof x === 'string') {
    try { x = JSON.parse(x); } catch { return null; }
  }
  if (!estObj(x)) return null;
  if (estObj(x.data) && !('devis' in x) && !('mission_id' in x)) return x.data as Obj;
  return x;
}

// ── Devis ────────────────────────────────────────────────────────────────────

export function lireDevis(v: unknown): DevisMission | null {
  const d = deballer(v);
  if (!d) return null;
  const max = nombre(d.jetons_max);
  if (max == null || max < 0) return null;
  const minBrut = nombre(d.jetons_min);
  const min = minBrut == null ? max : Math.min(Math.max(0, minBrut), max);
  return {
    jetons_min: Math.round(min),
    jetons_max: Math.round(max),
    ...(nombre(d.etapes_max) != null ? { etapes_max: entier(d.etapes_max) } : {}),
    ...(nombre(d.duree_estimee_min) != null ? { duree_estimee_min: entier(d.duree_estimee_min) } : {}),
    ...(texte(d.tier) ? { tier: texte(d.tier)! } : {}),
    ...(texte(d.explication) ? { explication: texte(d.explication)! } : {}),
    ...(texte(d.emis_le) ? { emis_le: texte(d.emis_le)! } : {}),
    ...(texte(d.expire_le) ? { expire_le: texte(d.expire_le)! } : {}),
  };
}

/** Phrase affichée quand un devis a dépassé sa durée de validité (24 h). */
export const MESSAGE_DEVIS_EXPIRE = 'Ce devis a expiré (plus de 24 h). Demandez-en un nouveau.';

/** Vrai si la date d'expiration du devis est dépassée. Sans date : jamais expiré côté écran. */
export function devisExpire(devis: Pick<DevisMission, 'expire_le'> | null | undefined, maintenant = Date.now()): boolean {
  const t = devis?.expire_le ? Date.parse(devis.expire_le) : NaN;
  return Number.isFinite(t) && t <= maintenant;
}

/** Noms sous lesquels une proposition de mission arrive dans le fil. */
export const NOMS_APPEL_DEVIS = ['proposer_mission', 'mission_devis'] as const;
export const estAppelDevis = (nom: string): boolean => (NOMS_APPEL_DEVIS as readonly string[]).includes(nom);

/**
 * Lit une proposition de mission, qu'elle vienne de l'événement SSE
 * `mission_devis` ou de la sortie de l'outil `proposer_mission` (relue en
 * base au rechargement de la conversation).
 */
export function lirePropositionDevis(v: unknown): PropositionDevis | null {
  const racine = deballer(v);
  if (!racine) return null;
  const m = estObj(racine.mission) ? (racine.mission as Obj) : racine;
  const missionId = texte(m.mission_id) ?? texte(m.id) ?? texte(racine.mission_id) ?? null;
  const devis = lireDevis(m.devis ?? racine.devis);
  const objectif = texte(m.objectif) ?? texte(racine.objectif);
  if (!missionId && !devis) return null;
  return { missionId, objectif, type: texte(m.type) ?? texte(racine.type_mission), devis };
}

/** Identifiant de mission porté par un événement `mission_devis` (pour la clé de la carte). */
export function idMissionEvenement(evt: unknown): string {
  return lirePropositionDevis(evt)?.missionId ?? `sans-id-${Date.now()}`;
}

interface AppelLike { id: string; name: string; output?: unknown; status?: string }
export type AffichageDevis =
  | { etat: 'carte'; proposition: PropositionDevis }
  | { etat: 'preparation' }
  | { etat: 'erreur' };

/**
 * Décide, pour chaque appel d'un message, s'il faut afficher une carte de
 * devis. Une même mission peut arriver deux fois (sortie de l'outil ET
 * événement `mission_devis`) : une seule carte par mission.
 */
export function devisAAfficher(appels: readonly AppelLike[]): Map<string, AffichageDevis> {
  const res = new Map<string, AffichageDevis>();
  const vus = new Set<string>();
  const devisAppels = appels.filter((a) => estAppelDevis(a.name));
  const props = devisAppels.map((a) => ({ a, p: a.status === 'running' ? null : lirePropositionDevis(a.output) }));
  const unAvecId = props.some((x) => x.p?.missionId);
  for (const { a, p } of props) {
    if (p?.missionId) {
      if (vus.has(p.missionId)) continue;
      vus.add(p.missionId);
      res.set(a.id, { etat: 'carte', proposition: p });
    } else if (!unAvecId) {
      if (a.status === 'running') res.set(a.id, { etat: 'preparation' });
      else if (p) res.set(a.id, { etat: 'carte', proposition: p });
      else if (a.status === 'error') res.set(a.id, { etat: 'erreur' });
    }
  }
  return res;
}

// ── Jetons et euros ──────────────────────────────────────────────────────────

export function formatJetons(n: number): string {
  const v = Math.max(0, Math.round(n));
  return `${v.toLocaleString('fr-FR')} jeton${v > 1 ? 's' : ''}`;
}

/** Montant en euros HT, à partir de la valeur du jeton DÉJÀ définie par l'application. */
export function formatEuros(jetons: number, valeurJetonEur: number): string {
  const eur = Math.max(0, jetons) * valeurJetonEur;
  const decimales = Number.isInteger(Math.round(eur * 100) / 100) ? 0 : 2;
  return eur.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + ' € HT';
}

export interface ResumeDevis {
  fourchette: string;
  fourchetteEuros: string;
  reserve: string;
  soldeSuffisant: boolean | null;
  manque: number;
}

export function resumerDevis(devis: DevisMission, solde: number | null, valeurJetonEur: number): ResumeDevis {
  const memes = devis.jetons_min === devis.jetons_max;
  const fourchette = memes ? formatJetons(devis.jetons_max)
    : `entre ${devis.jetons_min.toLocaleString('fr-FR')} et ${formatJetons(devis.jetons_max)}`;
  const fourchetteEuros = memes ? formatEuros(devis.jetons_max, valeurJetonEur)
    : `${formatEuros(devis.jetons_min, valeurJetonEur).replace(' € HT', ' €')} à ${formatEuros(devis.jetons_max, valeurJetonEur)}`;
  const soldeSuffisant = solde == null ? null : solde >= devis.jetons_max;
  return {
    fourchette, fourchetteEuros,
    reserve: formatJetons(devis.jetons_max),
    soldeSuffisant,
    manque: solde == null ? 0 : Math.max(0, devis.jetons_max - solde),
  };
}

export function dureeLisible(minutes: number | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `environ ${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return `environ ${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

// ── Missions ─────────────────────────────────────────────────────────────────

export const LIBELLE_STATUT: Record<string, string> = {
  devis: 'Devis à valider',
  en_attente: 'Démarrage…',
  en_cours: 'En cours',
  attente_utilisateur: 'Attend votre réponse',
  terminee: 'Terminée',
  budget_atteint: 'Arrêtée : budget atteint',
  echec: 'Échec',
  annulee: 'Annulée',
};
export const libelleStatut = (s: string): string => LIBELLE_STATUT[s] ?? s;

export const LIBELLE_TYPE: Record<string, string> = {
  prospection_fonciere: 'Prospection foncière',
  faisabilite: 'Étude de faisabilité',
  etude_marche: 'Étude de marché',
  veille: 'Veille',
  libre: 'Mission',
};
export const libelleType = (t: string): string => LIBELLE_TYPE[t] ?? 'Mission';

const ACTIFS = new Set(['en_attente', 'en_cours', 'attente_utilisateur']);
const FINIS = new Set(['terminee', 'budget_atteint', 'echec', 'annulee']);
export const missionActive = (s: string): boolean => ACTIFS.has(s);
export const missionFinie = (s: string): boolean => FINIS.has(s);
export const peutAnnuler = (s: string): boolean => s === 'devis' || ACTIFS.has(s);
export const peutRepondre = (m: Pick<Mission, 'statut' | 'question_en_attente'>): boolean =>
  m.statut === 'attente_utilisateur' && !!m.question_en_attente;

export type TonStatut = 'neutre' | 'actif' | 'attente' | 'succes' | 'alerte' | 'erreur';
export function tonStatut(s: string): TonStatut {
  if (s === 'en_cours' || s === 'en_attente') return 'actif';
  if (s === 'attente_utilisateur' || s === 'devis') return 'attente';
  if (s === 'terminee') return 'succes';
  if (s === 'budget_atteint') return 'alerte';
  if (s === 'echec') return 'erreur';
  return 'neutre';
}

export interface Progression {
  etapes: number; etapesMax: number; pctEtapes: number;
  consommes: number; reserves: number; pctJetons: number;
  restants: number;
}
const pct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);

export function progression(m: Pick<Mission, 'etapes_faites' | 'etapes_max' | 'jetons_consommes' | 'jetons_reserves' | 'statut'>): Progression {
  const etapesMax = Math.max(1, m.etapes_max || 1);
  const etapes = Math.min(Math.max(0, m.etapes_faites), etapesMax);
  const reserves = Math.max(0, m.jetons_reserves);
  const consommes = Math.max(0, Math.min(m.jetons_consommes, reserves || m.jetons_consommes));
  return {
    etapes, etapesMax,
    // Une mission finie a fini son travail, même si elle a pris moins d'étapes que prévu.
    pctEtapes: m.statut === 'terminee' ? 100 : pct(etapes, etapesMax),
    consommes, reserves,
    pctJetons: pct(consommes, reserves),
    restants: Math.max(0, reserves - consommes),
  };
}

export function lireMission(v: unknown): Mission | null {
  if (!estObj(v) || !texte(v.id)) return null;
  return {
    id: String(v.id),
    projet_id: texte(v.projet_id),
    conversation_id: texte(v.conversation_id),
    origine: texte(v.origine) ?? 'chat',
    type: texte(v.type) ?? 'libre',
    objectif: texte(v.objectif) ?? '',
    statut: texte(v.statut) ?? 'devis',
    devis: lireDevis(v.devis),
    jetons_reserves: entier(v.jetons_reserves),
    jetons_consommes: entier(v.jetons_consommes),
    etapes_faites: entier(v.etapes_faites),
    etapes_max: entier(v.etapes_max, 40),
    question_en_attente: texte(v.question_en_attente),
    rapport: lireRapport(v.rapport),
    rapport_brut: v.rapport ?? null,
    criteres: estObj(v.criteres) ? v.criteres : null,
    erreur: texte(v.erreur),
    cree_le: texte(v.cree_le),
    maj_le: texte(v.maj_le),
    termine_le: texte(v.termine_le),
  };
}

export function lireRapport(v: unknown): RapportMission | null {
  const r = deballer(v);
  if (!r) return null;
  const terrains: TerrainRapport[] = Array.isArray(r.terrains)
    ? r.terrains.filter(estObj).map((t) => ({
        idu: texte(t.idu) ?? '—',
        ...(texte(t.commune) ? { commune: texte(t.commune)! } : {}),
        ...(texte(t.adresse) ? { adresse: texte(t.adresse)! } : {}),
        surface_m2: nombre(t.surface_m2),
        zonage: texte(t.zonage),
        ...(texte(t.verdict) ? { verdict: texte(t.verdict)! } : {}),
        potentiel_logements: nombre(t.potentiel_logements),
        charge_fonciere_admissible: nombre(t.charge_fonciere_admissible),
        points_forts: listeTextes(t.points_forts),
        points_bloquants: listeTextes(t.points_bloquants),
        sources: listeTextes(t.sources),
      }))
    : [];
  const titre = texte(r.titre), synthese = texte(r.synthese);
  if (!titre && !synthese && terrains.length === 0) return null;
  return {
    titre: titre ?? 'Rapport de mission',
    synthese: synthese ?? '',
    terrains,
    actions_proposees: listeTextes(r.actions_proposees),
    memoire_ajoutee: entier(r.memoire_ajoutee),
    limites: listeTextes(r.limites),
    jetons_consommes: nombre(r.jetons_consommes),
  };
}

/** Couleur du verdict d'un terrain, à partir de mots simples. */
export function tonVerdict(verdict: string | undefined): 'bon' | 'moyen' | 'mauvais' | 'neutre' {
  const v = (verdict ?? '').toLowerCase();
  if (!v) return 'neutre';
  if (/(écart|ecart|bloqu|rejet|non retenu|défavorable|defavorable|impossible|à éviter|a eviter)/.test(v)) return 'mauvais';
  if (/(réserve|reserve|à creuser|a creuser|à vérifier|a verifier|moyen|possible|incertain|indéterminable|indeterminable)/.test(v)) return 'moyen';
  if (/(retenu|favorable|prioritaire|bon|intéressant|interessant|recommand)/.test(v)) return 'bon';
  return 'neutre';
}

// ── Journal ──────────────────────────────────────────────────────────────────

export const LIBELLE_JOURNAL: Record<string, string> = {
  plan: 'Plan',
  pensee: 'Réflexion',
  outil: 'Recherche',
  resultat: 'Résultat',
  question: 'Question',
  reponse: 'Votre réponse',
  memoire: 'Mémorisé',
  action: 'Brouillon préparé',
  erreur: 'Problème',
  fin: 'Fin',
};
export const libelleJournal = (g: string): string => LIBELLE_JOURNAL[g] ?? 'Étape';

export function lireLigneJournal(v: unknown): LigneJournal | null {
  if (!estObj(v)) return null;
  const resume = texte(v.resume);
  if (!resume) return null;
  return {
    id: (typeof v.id === 'number' || typeof v.id === 'string') ? v.id : `${v.n}-${resume.slice(0, 12)}`,
    n: entier(v.n),
    genre: texte(v.genre) ?? 'pensee',
    outil: texte(v.outil),
    resume,
    jetons: entier(v.jetons),
    cree_le: texte(v.cree_le),
  };
}

// ── Mémoire ──────────────────────────────────────────────────────────────────

export const LIBELLE_MEMOIRE: Record<string, string> = {
  fait: 'Fait', hypothese: 'Hypothèse', decision: 'Décision',
  preference: 'Préférence', document: 'Document', contact: 'Contact',
};
export const LIBELLE_CONFIANCE: Record<string, string> = {
  confirme: 'Confirmé', estime: 'Estimé', a_verifier: 'À vérifier',
};

export function lireMemoire(v: unknown): ElementMemoire | null {
  if (!estObj(v) || !texte(v.id)) return null;
  const contenu = typeof v.contenu === 'string' ? v.contenu : '';
  return {
    id: String(v.id),
    projet_id: texte(v.projet_id),
    mission_id: texte(v.mission_id),
    genre: texte(v.genre) ?? 'fait',
    cle: texte(v.cle),
    contenu,
    source: texte(v.source),
    confiance: texte(v.confiance),
    epingle: v.epingle === true,
    cree_le: texte(v.cree_le),
    maj_le: texte(v.maj_le),
  };
}

/** Épinglés d'abord, puis du plus récent au plus ancien. */
export function trierMemoire(items: readonly ElementMemoire[]): ElementMemoire[] {
  const t = (e: ElementMemoire) => Date.parse(e.maj_le ?? e.cree_le ?? '') || 0;
  return [...items].sort((a, b) => (Number(b.epingle) - Number(a.epingle)) || (t(b) - t(a)));
}

export const MEMOIRE_CONTENU_MAX = 4000;

// ── Actions externes ─────────────────────────────────────────────────────────

export function lireAction(v: unknown): ActionExterne | null {
  if (!estObj(v) || !texte(v.id)) return null;
  const d = estObj(v.destinataire) ? v.destinataire : {};
  return {
    id: String(v.id),
    mission_id: texte(v.mission_id),
    projet_id: texte(v.projet_id),
    canal: texte(v.canal) ?? 'email',
    destinataire: {
      nom: texte(d.nom) ?? 'Destinataire',
      qualite: texte(d.qualite) ?? 'autre',
      ...(texte(d.email) ? { email: texte(d.email)! } : {}),
      ...(texte(d.adresse) ? { adresse: texte(d.adresse)! } : {}),
    },
    objet: typeof v.objet === 'string' ? v.objet : '',
    corps: typeof v.corps === 'string' ? v.corps : '',
    statut: texte(v.statut) ?? 'brouillon',
    erreur: texte(v.erreur),
    cree_le: texte(v.cree_le),
    envoye_le: texte(v.envoye_le),
  };
}

export const LIBELLE_QUALITE: Record<string, string> = {
  proprietaire: 'Propriétaire', mairie: 'Mairie', notaire: 'Notaire', agence: 'Agence', autre: 'Contact',
};
export const LIBELLE_STATUT_ACTION: Record<string, string> = {
  brouillon: 'À relire', valide: 'Validé, pas encore envoyé', envoye: 'Envoyé', refuse: 'Refusé', echec: 'Envoi échoué',
};

/** Lien « ouvrir dans ma messagerie » (repli quand aucune boîte n'est connectée). */
export function lienMailto(a: Pick<ActionExterne, 'destinataire' | 'objet' | 'corps'>): string {
  const dest = a.destinataire.email ? encodeURIComponent(a.destinataire.email) : '';
  // Les messageries tronquent les liens trop longs : au-delà, on garde le début
  // et l'utilisateur colle le texte complet copié.
  const corps = a.corps.length > 1800 ? a.corps.slice(0, 1800) + '\n[…]' : a.corps;
  return `mailto:${dest}?subject=${encodeURIComponent(a.objet)}&body=${encodeURIComponent(corps)}`;
}

export function texteACopier(a: Pick<ActionExterne, 'destinataire' | 'objet' | 'corps' | 'canal'>): string {
  const lignes = [
    a.canal === 'courrier' && a.destinataire.adresse ? `${a.destinataire.nom}\n${a.destinataire.adresse}` : null,
    a.destinataire.email ? `À : ${a.destinataire.email}` : null,
    `Objet : ${a.objet}`,
    '',
    a.corps,
  ];
  return lignes.filter((l) => l !== null).join('\n');
}

export type IssueEnvoi =
  | { genre: 'envoye'; lienPdf: string | null }
  | { genre: 'boite_non_connectee'; mailto: string | null }
  | { genre: 'echec'; message: string };

/** Phrases simples pour les refus de agent-action-envoyer-v1. */
export const MESSAGE_RAISON_ENVOI: Record<string, string> = {
  profil_incomplet: 'Renseignez votre nom dans votre profil (Mon compte) pour pouvoir signer le courrier.',
  destinataire_incomplet: 'Le nom ou l’adresse du destinataire manque : corrigez le brouillon avant de le valider.',
  email_destinataire_invalide: 'L’adresse e-mail du destinataire n’est pas valide.',
  contenu_vide: 'L’objet ou le texte est vide.',
  non_valide: 'Ce brouillon doit d’abord être validé.',
  envoi_en_cours: 'Un envoi est déjà en cours pour ce brouillon. Patientez quelques secondes.',
  etat_concurrent: 'Ce brouillon vient d’être modifié ailleurs. Rechargez la liste.',
  introuvable: 'Ce brouillon est introuvable.',
  non_authentifie: 'Votre session a expiré. Reconnectez-vous.',
  echec_courrier: 'Le PDF du courrier n’a pas pu être préparé. Réessayez.',
  echec_envoi: 'L’envoi n’a pas abouti. Réessayez.',
};

/** Lit la réponse de agent-action-envoyer-v1. */
export function lireIssueEnvoi(v: unknown): IssueEnvoi {
  const r = deballer(v) ?? {};
  const lienPdf = lienSur(r.url) ?? lienSur(r.pdf_url) ?? lienSur(r.signed_url);
  if (r.ok === true) return { genre: 'envoye', lienPdf };
  const raison = texte(r.raison) ?? texte(r.reason) ?? '';
  if (raison === 'boite_non_connectee') {
    const repli = estObj(r.repli) ? r.repli : {};
    const mailto = texte(repli.mailto);
    return { genre: 'boite_non_connectee', mailto: mailto && mailto.startsWith('mailto:') ? mailto : null };
  }
  return { genre: 'echec', message: MESSAGE_RAISON_ENVOI[raison] ?? texte(r.message) ?? texte(r.erreur) ?? "L'envoi n'a pas abouti." };
}

// ── Briefing ─────────────────────────────────────────────────────────────────

export const LIBELLE_BRIEFING: Record<string, string> = {
  opportunite: 'Opportunité', permis: 'Permis', plu: 'PLU', marche: 'Marché', alerte: 'Alerte',
};

/** N'accepte que des liens internes ou http(s) (pas de `javascript:`). */
export function lienSur(lien: unknown): string | null {
  const l = texte(lien);
  if (!l) return null;
  if (l.startsWith('/') && !l.startsWith('//')) return l;
  return /^https?:\/\//i.test(l) ? l : null;
}

export function lireBriefing(v: unknown): Briefing | null {
  if (!estObj(v) || !texte(v.id)) return null;
  const elements: ElementBriefing[] = Array.isArray(v.elements)
    ? v.elements.filter(estObj).flatMap((e) => {
        const titre = texte(e.titre);
        if (!titre) return [];
        const lien = lienSur(e.lien);
        return [{
          genre: texte(e.genre) ?? 'alerte',
          titre,
          detail: texte(e.detail) ?? '',
          ...(lien ? { lien } : {}),
          ...(texte(e.mission_id) ? { mission_id: texte(e.mission_id)! } : {}),
          ...(texte(e.source) ? { source: texte(e.source)! } : {}),
        }];
      })
    : [];
  return {
    id: String(v.id),
    titre: texte(v.titre) ?? 'Pendant votre absence',
    resume: texte(v.resume) ?? '',
    elements,
    lu: v.lu === true,
    cree_le: texte(v.cree_le),
    mission_id: texte(v.mission_id),
  };
}

// ── Veille proactive ─────────────────────────────────────────────────────────

export const BUDGET_PROACTIF_MAX = 20000;
export const bornerBudget = (n: number): number =>
  Math.max(0, Math.min(BUDGET_PROACTIF_MAX, Math.round(Number.isFinite(n) ? n : 0)));

// ── Dates ────────────────────────────────────────────────────────────────────

export function dateCourte(iso: string | null, maintenant = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jours = Math.floor((new Date(maintenant).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
  if (jours <= 0) return `aujourd'hui, ${heure}`;
  if (jours === 1) return `hier, ${heure}`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + `, ${heure}`;
}

// ── Erreurs serveur → phrases simples ────────────────────────────────────────

interface ErreurLike { message?: unknown; hint?: unknown; code?: unknown; details?: unknown }

/** Indique que les tables / fonctions de l'agent ne sont pas encore installées. */
export function agentNonInstalle(err: unknown): boolean {
  const e = (err ?? {}) as ErreurLike;
  const code = String(e.code ?? '');
  const msg = String(e.message ?? '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883'
    || code === '42703' || /does not exist|could not find the (table|function)/i.test(msg);
}

export function messageErreurAgent(err: unknown): string {
  const e = (err ?? {}) as ErreurLike;
  const hint = String(e.hint ?? '');
  const msg = typeof e.message === 'string' ? e.message.trim() : '';
  if (agentNonInstalle(err)) return "Cette fonction n'est pas encore activée. Réessayez un peu plus tard.";
  if (hint === 'agent_solde_insuffisant') return `${msg || 'Solde insuffisant.'} Vous pouvez recharger vos jetons depuis votre abonnement.`;
  if (hint === 'agent_devis_expire') return MESSAGE_DEVIS_EXPIRE;
  if (hint === 'agent_missions_plafond') return msg || 'Vous avez déjà 3 missions en cours.';
  if (msg === 'NOT_AUTHENTICATED') return 'Votre session a expiré. Reconnectez-vous.';
  if (msg === 'MISSION_INTROUVABLE') return 'Cette mission est introuvable.';
  if (msg === 'ACTION_INTROUVABLE') return 'Ce brouillon est introuvable.';
  if (/failed to fetch|network/i.test(msg)) return 'Connexion impossible. Vérifiez votre réseau et réessayez.';
  // Les messages écrits par nos fonctions SQL sont déjà en français clair.
  const technique = /violates|syntax|permission denied|duplicate key|null value|invalid input|jwt|row-level/i;
  if (msg && msg.includes(' ') && !technique.test(msg)) return msg;
  return "L'opération n'a pas abouti. Réessayez dans un instant.";
}

/** Mois en cours, au format de la colonne `proactif_mois` (premier jour du mois). */
export function consommeCeMois(consomme: unknown, mois: unknown, maintenant = new Date()): number {
  const m = texte(mois);
  if (!m) return 0;
  const d = new Date(m);
  if (!Number.isFinite(d.getTime())) return 0;
  const memeMois = d.getUTCFullYear() === maintenant.getUTCFullYear() && d.getUTCMonth() === maintenant.getUTCMonth();
  return memeMois ? Math.max(0, entier(consomme)) : 0;
}
