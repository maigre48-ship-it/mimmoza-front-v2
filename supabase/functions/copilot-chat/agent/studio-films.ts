// supabase/functions/copilot-chat/agent/studio-films.ts
// =============================================================
// VIS-46 (25/11/2026) — LE CHAT PROPOSE DES FILMS. Outil `studio_proposer_film` :
//   · sur une demande de film, le SERVEUR construit 3 scénarios (contrat ScenarioFilm v1) sur le PROJET EN VIGUEUR de la
//     conversation (bâtiment dessiné → éléments, ouvertures, toits ; sinon brief d'habillage) : aucun plan impossible ;
//   · une phrase (« raccourcis à 30 s », « ajoute un plan sur la cuisine », « plus de drone ») modifie le scénario en cours
//     (version suivante, différences pour le surlignage) — sans IA, déterministe ; un ajout impossible est refusé et DIT ;
//   · le modèle peut aussi RÉÉCRIRE un scénario (`scenario`) : revalidé (validerScenario) et contrôlé (plans impossibles).
// La carte « Scénario du film » du chat est la SEULE commande : « Valider et lancer le film » (un clic = devis + lancement,
// studio_lancer_rendu avec le bloc ```mimmoza-scenario``` du message reçu), « Aperçu » (gratuit, pont VIS-45 → Studio).
// Rien n'est écrit ni facturé par cet outil (seul le tour de conversation compte, comme d'habitude).
// =============================================================
import type { OutilDef, ResultatOutil } from './types.ts';
import { briefDuFil, type DepotStudio } from './studio.ts';
import { lireProjetEnVigueur } from '../../../../src/lib/studio/projetEnVigueur.ts';
import { empreinteScenario, resumerScenario, validerScenario, type ScenarioFilm } from '../../../../src/lib/studio/scenarioFilm.ts';
import {
  BLOC_SCENARIO, capacitesDepuisBrief, capacitesDepuisModele, differencesScenarios, lireBlocScenario, modifierScenarioParPhrase,
  OUTIL_PROPOSER_FILM, plansImpossibles, proposerScenarios, type BlocScenario, type CapacitesFilm, type DifferencesScenario,
} from '../../../../src/lib/studio/filmsChat.ts';

export { OUTIL_PROPOSER_FILM };
export const SOURCE_FILMS = 'MimmozIA · Films';

export const OUTIL_PROPOSER_FILM_DEF: OutilDef = {
  name: OUTIL_PROPOSER_FILM,
  description:
    'FILMS DU PROJET (scénarios) : propose 3 scénarios de film construits sur le projet en 3D de la conversation, ou modifie ' +
    'le scénario en cours. QUAND : l’utilisateur demande un film / une vidéo (« fais-moi un film », bouton film, étapes film ' +
    'du parcours), ou demande une modification du film proposé (« raccourcis à 30 s », « ajoute un plan sur la cuisine », ' +
    '« plus de drone », « en vertical », « de nuit », « sans musique »). COMMENT : sans argument → 3 propositions ; ' +
    '`modification` = la phrase de l’utilisateur telle quelle ; `scenario` = un scénario réécrit par toi (contrat ScenarioFilm v1) ' +
    'seulement si la phrase n’a pas pu être appliquée. APRÈS L’APPEL : une carte affiche les scénarios (modifiables, « Valider et ' +
    'lancer le film », « Aperçu ») ; présente-les en une ligne chacun, ne recopie pas les plans, ne pose AUCUNE question de durée, ' +
    'de format ou d’ambiance, n’annonce aucun lancement. Le lancement se fait par le bouton de la carte (studio_lancer_rendu).',
  input_schema: {
    type: 'object',
    properties: {
      modification: { type: 'string', description: 'Phrase de modification de l’utilisateur, telle quelle.' },
      scenario: { type: 'object', description: 'Scénario réécrit (ScenarioFilm v1) — seulement si la phrase n’a pas été appliquée.' },
      nouvelles_propositions: { type: 'boolean', description: 'Vrai : repartir de 3 nouvelles propositions (l’utilisateur le demande).' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

/* ─── Lecture de la conversation ─── */

export interface DepotFilms {
  /** Sorties `data` des appels studio_proposer_film de la conversation (plus récentes d'abord) ; erreur → []. */
  sortiesFilm(userId: string, conversationId: string): Promise<Record<string, unknown>[]>;
  /** Messages UTILISATEUR portant un bloc ```mimmoza-scenario``` (plus récents d'abord) ; erreur → []. */
  scenariosMessages(userId: string, conversationId: string): Promise<{ texte: string; cree_le: string }[]>;
}

type Admin = { from(t: string): any };
const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function depotFilmsSupabase(admin: Admin): DepotFilms {
  return {
    async sortiesFilm(userId, conversationId) {
      try {
        const { data, error } = await admin.from('copilot_tool_calls').select('tool_output')
          .eq('user_id', userId).eq('conversation_id', conversationId).eq('tool_name', OUTIL_PROPOSER_FILM)
          .order('created_at', { ascending: false }).limit(10);
        if (error || !Array.isArray(data)) return [];
        return data.flatMap((l: { tool_output?: { status?: unknown; data?: unknown } }) => (l.tool_output?.status === 'ok' && estObj(l.tool_output.data) ? [l.tool_output.data] : []));
      } catch { return []; }
    },
    async scenariosMessages(userId, conversationId) {
      try {
        const { data, error } = await admin.from('copilot_messages').select('content,created_at')
          .eq('user_id', userId).eq('conversation_id', conversationId).eq('role', 'user')
          .order('created_at', { ascending: false }).limit(20);
        if (error || !Array.isArray(data)) return [];
        return data.flatMap((l: { content?: unknown; created_at?: unknown }) => {
          const texte = Array.isArray(l.content) ? l.content.map((c) => (estObj(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n') : '';
          return texte.includes('```' + BLOC_SCENARIO) && typeof l.created_at === 'string' ? [{ texte, cree_le: l.created_at }] : [];
        });
      } catch { return []; }
    },
  };
}

/* ─── Projet en vigueur → ce qu'on peut filmer ─── */

export interface ProjetFilme { capacites: CapacitesFilm; source: 'dessin' | 'brief'; preparationId: string }

const AMBIANCE_BRIEF: Record<string, ScenarioFilm['ambiance']> = { jour: 'jour', fin_de_journee: 'fin_de_journee', nuit: 'nuit' };

/** Capacités du PROJET EN VIGUEUR (3D préparée courante de la conversation) ; null sans 3D préparée. */
export async function projetFilme(depot: DepotStudio, userId: string, conversationId: string): Promise<ProjetFilme | null> {
  let prep = null;
  try { prep = await depot.preparation(userId, { conversationId }); } catch { prep = null; }
  if (!prep) return null;
  const brief = (await briefDuFil(depot, userId, conversationId))?.brief ?? null;
  const ambiance = brief ? AMBIANCE_BRIEF[brief.ambiance] ?? null : null;
  const pv = lireProjetEnVigueur(prep.entree, conversationId);
  if (pv) return { capacites: capacitesDepuisModele(pv.modele, { empreinte: pv.empreinte, ambiance }), source: 'dessin', preparationId: prep.id };
  const resume = estObj(prep.resume) ? prep.resume : {};
  const nom = typeof resume.titre === 'string' ? resume.titre : null;
  return {
    capacites: capacitesDepuisBrief({ nom, balcons: brief?.balcons ?? null, toiture: brief?.toiture ?? null, empreinte: prep.empreinte, ambiance }),
    source: 'brief', preparationId: prep.id,
  };
}

/* ─── État de la carte dans la conversation ─── */

export interface EtatCarteFilm { version: number; propositions: ScenarioFilm[]; choisi: number | null }

/** Dernière carte de la conversation (sortie de l'outil, revalidée) ; null si aucune. */
export function derniereCarte(sorties: readonly Record<string, unknown>[]): EtatCarteFilm | null {
  for (const d of sorties) {
    if (d.carte !== 'scenarios-film' || !Array.isArray(d.propositions)) continue;
    const props = d.propositions.map((p) => validerScenario(p)).flatMap((v) => (v.ok ? [v.scenario] : []));
    if (!props.length) continue;
    const choisi = typeof d.choisi === 'number' && d.choisi >= 0 && d.choisi < props.length ? d.choisi : null;
    return { version: typeof d.version === 'number' ? d.version : 1, propositions: props, choisi };
  }
  return null;
}

/** Retire les plans impossibles (s'il en reste au moins 3), et le DIT ; null si le scénario ne tient plus. */
function sansImpossibles(s: ScenarioFilm, c: CapacitesFilm): { scenario: ScenarioFilm; refus: string[] } | null {
  const imp = plansImpossibles(s, c);
  if (!imp.length) return { scenario: s, refus: [] };
  const plans = s.plans.filter((p) => !imp.some((i) => i.id === p.id));
  const v = validerScenario({ ...s, plans, duree_s: plans.reduce((a, p) => a + p.duree_s, 0) });
  if (!v.ok) return null;
  return { scenario: v.scenario, refus: imp.map((i) => `plan ${i.rang} retiré : ${i.raison}`) };
}

export interface EnvFilms {
  userId: string | null;
  conversationId: string | null;
  depot: DepotStudio;
  depotFilms: DepotFilms;
  /** Bloc ```mimmoza-scenario``` du message REÇU (relu par index.ts), jamais une valeur du modèle. */
  scenarioCarte?: { ok: true; valeur: BlocScenario } | { ok: false; erreurs: string[] } | null;
  /** Texte du message reçu (la phrase de modification par défaut). */
  texteRecu?: string;
}

const COUT = 'Aucun débit pour le film : les rendus ne sont pas facturés aujourd’hui (seul ce message du chat est compté, comme d’habitude). L’aperçu est gratuit.';

function sortie(etat: EtatCarteFilm, plus: { differences?: DifferencesScenario[]; changements?: string[]; refus?: string[]; projet: ProjetFilme; message: string }): ResultatOutil {
  return {
    status: 'ok', source: SOURCE_FILMS,
    data: {
      carte: 'scenarios-film', version: etat.version, choisi: etat.choisi,
      // Résumés EN PREMIER : le rappel des résultats (index.ts) ne garde que le début de la sortie.
      resumes: etat.propositions.map(resumerScenario),
      empreintes: etat.propositions.map(empreinteScenario),
      propositions: etat.propositions,
      differences: plus.differences ?? [],
      changements: plus.changements ?? [], refus: plus.refus ?? [],
      projet: { nom: plus.projet.capacites.nom, source: plus.projet.source, empreinte: plus.projet.capacites.empreinte_projet, sujets: plus.projet.capacites.sujets, raisons: plus.projet.capacites.raisons },
      cout: COUT,
    },
    message: plus.message,
  };
}

const CONSIGNE_CARTE = ' La carte « Scénario du film » s’affiche sous ta réponse : chaque scénario y est modifiable (intention, plans, durées, mouvements, ordre, ambiance, format, musique, voix off) ' +
  'avec « Valider et lancer le film » (un seul clic : le devis et le lancement, sans autre question) et « Aperçu » (gratuit). Ne recopie pas les plans, ne pose AUCUNE question, n’annonce aucun lancement.';

/** Exécution de l'outil. N'écrit rien. */
export async function executerOutilProposerFilm(input: Record<string, unknown>, env: EnvFilms): Promise<ResultatOutil> {
  const err = (m: string, status = 'error'): ResultatOutil => ({ status, source: SOURCE_FILMS, message: m });
  if (!env.userId || !env.conversationId) return err('Ouvrez d’abord une conversation : le film est rattaché au projet du chat. Rien n’a été proposé.');
  const projet = await projetFilme(env.depot, env.userId, env.conversationId);
  if (!projet) return err('Aucune 3D préparée dans cette conversation : le film se construit sur le projet en 3D. Prépare d’abord la 3D (studio_preparer_3d), puis propose les scénarios. Rien n’a été proposé.', 'partial');
  const cap = projet.capacites;
  const precedente = derniereCarte(await env.depotFilms.sortiesFilm(env.userId, env.conversationId));
  const carte = env.scenarioCarte ?? null;
  if (carte && !carte.ok) return err(`Le scénario de la carte n’a pas été accepté (${carte.erreurs.join(' ; ')}). Rien n’a été modifié : propose à l’utilisateur de corriger la carte.`);

  // 1. Carte modifiée à la main (bloc du message reçu) : elle devient la version suivante.
  if (carte?.ok && carte.valeur.action !== 'lancer') {
    const nettoye = sansImpossibles(carte.valeur.scenario, cap);
    if (!nettoye) return err('Le scénario de la carte ne garde pas 3 plans possibles pour ce projet. Rien n’a été modifié.');
    const base = precedente?.propositions ?? [];
    const idx = precedente && precedente.choisi !== null ? precedente.choisi : Math.max(0, base.findIndex((p) => p.titre === nettoye.scenario.titre));
    const propositions = base.length ? base.map((p, i) => (i === idx ? nettoye.scenario : p)) : [nettoye.scenario];
    const etat: EtatCarteFilm = { version: Math.max(carte.valeur.version, (precedente?.version ?? 0) + 1), propositions, choisi: base.length ? idx : 0 };
    return sortie(etat, {
      projet, refus: [...carte.valeur.corrections, ...nettoye.refus],
      differences: propositions.map((p, i) => differencesScenarios(base[i] ?? null, p)),
      message: `Scénario « ${nettoye.scenario.titre} » enregistré (version ${etat.version}).${nettoye.refus.length ? ` Retiré car impossible pour ce projet : ${nettoye.refus.join(' ; ')} — dis-le.` : ''}${CONSIGNE_CARTE}`,
    });
  }

  // 2. Réécriture par le modèle (seulement si la phrase n'a pas été appliquée).
  if (estObj(input.scenario) && precedente) {
    const v = validerScenario({ ...input.scenario, ...(cap.empreinte_projet ? { empreinte_projet: cap.empreinte_projet } : {}) });
    if (!v.ok) return err(`Scénario refusé : ${v.erreurs.join(' ; ')}. Rien n’a été modifié.`);
    const nettoye = sansImpossibles(v.scenario, cap);
    if (!nettoye) return err('Ce scénario ne garde pas 3 plans possibles pour ce projet. Rien n’a été modifié.');
    const idx = precedente.choisi ?? 0;
    const propositions = precedente.propositions.map((p, i) => (i === idx ? nettoye.scenario : p));
    const etat = { version: precedente.version + 1, propositions, choisi: idx };
    return sortie(etat, {
      projet, refus: [...v.corrections, ...nettoye.refus], differences: propositions.map((p, i) => differencesScenarios(precedente.propositions[i] ?? null, p)),
      message: `Scénario modifié (version ${etat.version}).${v.corrections.length || nettoye.refus.length ? ` Corrections à dire : ${[...v.corrections, ...nettoye.refus].join(' ; ')}.` : ''}${CONSIGNE_CARTE}`,
    });
  }

  // 3. Modification par phrase (scénario choisi, sinon les trois).
  const phrase = typeof input.modification === 'string' && input.modification.trim() ? input.modification.trim() : null;
  if (phrase && precedente && input.nouvelles_propositions !== true) {
    const cibles = precedente.choisi !== null ? [precedente.choisi] : precedente.propositions.map((_, i) => i);
    const changements: string[] = [];
    const refus: string[] = [];
    const propositions = precedente.propositions.map((p, i) => {
      if (!cibles.includes(i)) return p;
      const r = modifierScenarioParPhrase(p, phrase, cap);
      if (r.ok) changements.push(...r.changements.map((c) => (cibles.length > 1 ? `« ${p.titre} » : ${c}` : c)));
      refus.push(...r.refus.map((c) => (cibles.length > 1 ? `« ${p.titre} » : ${c}` : c)));
      return r.ok ? r.scenario : p;
    });
    if (!changements.length) {
      return err(`Phrase non appliquée${refus.length ? ` (${[...new Set(refus)].join(' ; ')})` : ''}. Si c’est un refus (plan impossible pour ce projet), dis-le simplement. ` +
        'Sinon, rappelle l’outil avec `scenario` = le scénario en cours réécrit selon la demande (même contrat), ou demande une précision en UNE question.', 'partial');
    }
    const etat = { version: precedente.version + 1, propositions, choisi: precedente.choisi };
    return sortie(etat, {
      projet, changements, refus: [...new Set(refus)], differences: propositions.map((p, i) => differencesScenarios(precedente.propositions[i], p)),
      message: `Scénario${cibles.length > 1 ? 's' : ''} modifié${cibles.length > 1 ? 's' : ''} (version ${etat.version}) : ${changements.join(' ; ')}.${refus.length ? ` Non appliqué : ${[...new Set(refus)].join(' ; ')} — dis-le.` : ''} Les différences sont surlignées dans la carte.${CONSIGNE_CARTE}`,
    });
  }

  // 4. Trois propositions.
  const propositions = proposerScenarios(cap);
  const etat = { version: (precedente?.version ?? 0) + 1, propositions, choisi: null };
  const absents = (['balcon', 'terrasse', 'jardin', 'vue_depuis_baie'] as const).filter((s) => !cap.sujets.includes(s)).map((s) => `${s.replace(/_/g, ' ')} (${cap.raisons[s]})`);
  return sortie(etat, {
    projet,
    message: `3 scénarios proposés pour « ${cap.nom} » : ${propositions.map((p, i) => `${i + 1}. ${p.titre} (${p.duree_s} s, ${p.format})`).join(' ; ')}. ` +
      `Construits sur le projet en vigueur (${projet.source === 'dessin' ? 'bâtiment dessiné' : 'volume et habillage'})${absents.length ? ` ; pas de plan sur : ${absents.join(', ')}` : ''}.${CONSIGNE_CARTE}`,
  });
}

/* ─── Aiguillage du tour ─── */

const sansAccents = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'");

/** Le message demande-t-il un FILM (pas une visite, pas une image) ? Pur. */
export function demandeFilm(texte: string): boolean {
  const t = sansAccents(texte ?? '');
  if (!/\b(films?|videos?|clip|teaser|scenarios? de film)\b/.test(t)) return false;
  // Accord donné à un devis déjà présenté (« oui, lance le film ») : ce n'est pas une nouvelle demande de film.
  if (/^\s*(oui|ok|okay|d'accord|vas[- ]y|go|confirme|je confirme|parfait|valide)\b/.test(t)) return false;
  if (/\b(pas|sans|aucun|ni)\s+(de\s+|d'|le\s+|la\s+)?(films?|videos?)\b/.test(t)) return false;
  return !/\bvisite\s*(360|virtuelle|immersive)|\bimages?\b/.test(t) || /\bfilms?\b/.test(t);
}

/** Le message modifie-t-il un film déjà proposé (suite d'une carte de scénarios) ? Pur. */
export function modificationFilm(texte: string): boolean {
  const t = sansAccents(texte ?? '');
  return /\b(raccourci|allonge|rallonge|ajoute|rajoute|enleve|retire|supprime|plus de drone|moins de drone|sans drone|vertical|paysage|carre|9\s*[:/]\s*16|16\s*[:/]\s*9|de nuit|coucher|couvert|musique|voix off|\d+\s*(s|sec|secondes|min)\b|plan)/.test(t);
}

/** La réponse précédente de Mimmo portait-elle la carte des scénarios ? (texte de la consigne) */
export const MARQUE_CARTE_FILM = 'Scénario du film';
