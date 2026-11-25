// supabase/functions/copilot-chat/agent/studio-commandes.ts
// =============================================================
// VIS-45 (25/11/2026) — UN SEUL CHAT : le chat Mimmoza COMMANDE le Studio 3D.
//
// Outil `studio_commander` : le modèle choisit une commande du catalogue (copie identique Studio/site :
// src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts) ou une phrase française que le Studio rejoue SANS IA.
// Le serveur VALIDE (catalogue fermé, paramètres) et rend une carte ; c'est le SITE qui transmet la commande à l'onglet
// Studio (ou la met en attente s'il est fermé) et range le compte rendu du Studio dans la conversation (sans jetons).
// Rien n'est exécuté ni facturé ici en dehors du tour de conversation lui-même (pas de seconde IA, pas de devis).
//
// Accord : une commande longue (rendu Unreal, plans d'architecte) part seulement avec l'accord de l'utilisateur, lu dans
// le message REÇU (jamais déduit des paramètres du modèle) : réponse « oui… » à la question, ou demande explicite dans
// le même message (« génère les plans d'architecte ») — jamais deux fois la même question.
//
// Mémoire : `blocComptesRendusStudio` résume les derniers comptes rendus du Studio (copilot_action_runs, origine
// « studio ») pour le système : le chat sait ce qui a été fait dans le Studio (un seul fil, une seule mémoire).
// Module PUR (testé par Deno) — aucune dépendance à index.ts.
// =============================================================
import type { OutilDef, ResultatOutil } from './types.ts';
import {
  CATALOGUE_COMMANDES_CHAT, entreeCatalogue, PHRASE_EN_ATTENTE, validerCommandeChat,
} from '../../../../src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts';

export const OUTIL_STUDIO_COMMANDER = 'studio_commander';
export const SOURCE_COMMANDES = 'MimmozIA · Studio 3D';

const listeCommandes = CATALOGUE_COMMANDES_CHAT.map((e) => {
  const params = Object.entries(e.params).map(([k, p]) => `${k}${p.requis ? '' : '?'}${p.valeurs ? `=${p.valeurs.join('|')}` : `:${p.type}`}`).join(', ');
  return `· ${e.id}${params ? ` (${params})` : ''} — ${e.quoi}${e.confirmation ? ' [ACCORD requis]' : ''}`;
}).join('\n');

export const OUTIL_STUDIO_COMMANDER_DEF: OutilDef = {
  name: OUTIL_STUDIO_COMMANDER,
  description:
    "PILOTE LE STUDIO 3D du projet (l'onglet Studio ouvert depuis ce chat) : le chat Mimmoza est le SEUL chat, le Studio exécute. " +
    "QUAND : l'utilisateur demande un geste sur le projet en 3D — meubler / aménager le logement (style, gamme, occupants), " +
    "poser / retirer / déplacer un meuble, changer un sol, des murs, l'ambiance d'une pièce, la lumière, un style ou une matière " +
    "de façade, ouvrir le Studio sur une étape, lancer la visite / les images / le film Unreal, « génère les plans d'architecte ». " +
    "COMMENT : `commande` = un identifiant du catalogue et `params` ses paramètres ; pour ce que le catalogue ne couvre pas " +
    "(ex. « mets la façade en brique », « ajoute un étage », « toiture en zinc »), `phrase` = la demande en une phrase française " +
    "simple, que le Studio rejoue sans IA. UNE commande par appel. " +
    "ACCORD : pour une commande marquée [ACCORD requis], demande d'abord « oui » à l'utilisateur, sauf s'il l'a demandée " +
    "explicitement dans son message ; puis appelle avec `confirme: true`. " +
    "APRÈS L'APPEL : ne dis JAMAIS que c'est fait — la carte affiche le compte rendu du Studio ; si le Studio est fermé, la " +
    "commande attend et s'exécute à son ouverture (dis-le en une phrase). Plan d'un logement FOURNI par l'utilisateur (pas le " +
    "projet en 3D) : c'est `amenager_interieur`, pas cet outil. Rendus livrés (fichiers, devis en jetons) : `studio_lancer_rendu`.\n" +
    `Catalogue :\n${listeCommandes}`,
  input_schema: {
    type: 'object',
    properties: {
      commande: { type: 'string', enum: CATALOGUE_COMMANDES_CHAT.map((e) => e.id), description: 'Identifiant du catalogue.' },
      params: { type: 'object', description: 'Paramètres de la commande (voir le catalogue).' },
      phrase: { type: 'string', description: 'Demande en une phrase française (si aucune commande du catalogue ne convient).' },
      confirme: { type: 'boolean', description: 'Accord de l’utilisateur pour une commande [ACCORD requis].' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

const sansAccents = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'");

/** Le tour parle d'un geste du Studio (outil proposé au modèle). Pur. */
export function studioCommandePertinente(textes: readonly string[]): boolean {
  const RE = /\b(meubl|amenag|canape|lit\b|table|fauteuil|bibliotheque|meuble|parquet|carrelage|moquette|tomette|beton cire|sol\b|sols\b|murs?\b|peins|peinture|ambiance|lumiere|eclairage|facade|matiere|brique|enduit|bardage|style|studio|3d|visite|film|images?\b|plans? d'architecte|plans?\b|dxf|ifc|autocad|surface habitable|deplace|decale|tourne|pousse|enleve|retire|ajoute|mets?\b|etage|toiture|toit)/;
  return textes.some((t) => RE.test(sansAccents(t ?? '')));
}

const RE_ACCORD = /^\s*(oui|ouais|ok|okay|d'accord|daccord|vas[- ]y|go|lance[rz]?|c'est parti|confirme[rz]?|je confirme|valide[rz]?|parfait|allez)\b/;
const DEMANDES_EXPLICITES: Readonly<Record<string, RegExp>> = {
  'plans-architecte': /\b(genere|generer|fais|faire|fait|produis|produire|sors|sortir|donne|donner|cree|creer|prepare|preparer|envoie|telecharge|veux|voudrais|faudrait)\b[^.?!]*\bplans?\b|\bplans? d'architecte\b/,
  film: /\b(lance|lancer|fais|faire|genere|generer|produis|produire)\b[^.?!]*\bfilm\b/,
  'lancer-visite': /\b(lance|lancer|ouvre|ouvrir|demarre|demarrer|fais|faire)\b[^.?!]*\bvisite\b/,
  'produire-images': /\b(lance|lancer|fais|faire|genere|generer|produis|produire)\b[^.?!]*\bimages?\b/,
  'interieur-images': /\b(lance|lancer|fais|faire|genere|generer|produis|produire)\b[^.?!]*\bimages?\b/,
};

/** L'accord pour une commande longue est-il dans le message REÇU ? (réponse « oui », ou demande explicite). Pur. */
export function accordDansLeMessage(commande: string, texteRecu: string): boolean {
  const t = sansAccents(texteRecu);
  if (RE_ACCORD.test(t)) return true;
  const re = DEMANDES_EXPLICITES[commande];
  return re ? re.test(t) : false;
}

export interface EnvCommander {
  /** Texte du message de l'utilisateur reçu à ce tour (pas les paramètres du modèle). */
  texteRecu: string;
  maintenant?: () => number;
}

/** Exécution de l'outil (validation seulement ; le site transmet). Pur. */
export function executerOutilStudioCommander(input: Record<string, unknown>, env: EnvCommander): ResultatOutil {
  const err = (message: string): ResultatOutil => ({ status: 'error', source: SOURCE_COMMANDES, message });
  const phrase = typeof input.phrase === 'string' ? input.phrase.replace(/\s+/g, ' ').trim() : '';
  const id = typeof input.commande === 'string' && input.commande.trim() ? input.commande.trim() : null;
  if (!id && !phrase) return err('Indique `commande` (identifiant du catalogue) ou `phrase` (demande en français). Rien n’a été envoyé au Studio.');
  if (!id && phrase.length > 300) return err('La phrase dépasse 300 caractères : une demande simple à la fois. Rien n’a été envoyé.');
  let commande: { id: string; params: Record<string, string | number | boolean>; confirme?: boolean } | null = null;
  let libelle = 'Demande au Studio';
  if (id) {
    const v = validerCommandeChat(id, input.params ?? {});
    if (!v.ok) return err(`Commande refusée : ${(v as { erreur: string }).erreur}. Rien n’a été envoyé au Studio.`);
    const e = entreeCatalogue(v.id)!;
    libelle = e.libelle;
    if (e.confirmation) {
      const accord = input.confirme === true && accordDansLeMessage(e.id, env.texteRecu);
      if (!accord) {
        return {
          status: 'ok', source: SOURCE_COMMANDES,
          message: `« ${e.libelle} » est une action longue : demande l'accord de l'utilisateur en UNE question courte (« Je lance ${e.libelle.toLowerCase()} dans le Studio ? »). Rien n'a été envoyé. Quand il répond « oui », rappelle l'outil avec confirme: true.`,
          data: { carte: 'attente-accord', commande: v.id },
        };
      }
      commande = { id: v.id, params: v.params, confirme: true };
    } else {
      commande = { id: v.id, params: v.params };
    }
  } else {
    libelle = `« ${phrase.length > 60 ? `${phrase.slice(0, 57)}…` : phrase} »`;
  }
  return {
    status: 'ok', source: SOURCE_COMMANDES,
    message: `Commande transmise au Studio (${libelle}). Ne dis pas qu'elle est faite : la carte sous ta réponse affiche le compte rendu du Studio. Si le Studio n'est pas ouvert : « ${PHRASE_EN_ATTENTE} » Réponds en UNE phrase courte.`,
    data: { carte: 'commande-studio', commande, phrase: commande ? null : phrase, libelle, emis_le: (env.maintenant ?? Date.now)() },
  };
}

/* ─── Mémoire : derniers comptes rendus du Studio ─── */

export interface LigneTraceStudio { created_at?: unknown; message?: unknown; outcome?: unknown; params?: unknown }

const heure = (iso: unknown): string => {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
};

/** Bloc système (vide s'il n'y a rien) : ce que le Studio a fait / dit, du plus ancien au plus récent. Pur. */
export function blocComptesRendusStudio(lignes: readonly LigneTraceStudio[], max = 8): string {
  const utiles = lignes.filter((l) => typeof l.message === 'string' && (l.message as string).trim() && typeof l.params === 'object' && l.params !== null
    && (l.params as Record<string, unknown>).origine === 'studio').slice(0, max).reverse();
  if (utiles.length === 0) return '';
  const lignesTexte = utiles.map((l) => {
    const p = l.params as Record<string, unknown>;
    const quoi = p.type === 'notification' ? 'Studio' : `${typeof p.libelle === 'string' && p.libelle ? p.libelle : 'Commande'} → ${l.outcome === 'done' ? 'fait' : l.outcome === 'refused' ? 'non exécutée' : 'échec'}`;
    const fichiers = Array.isArray(p.fichiers) ? ` (fichiers : ${(p.fichiers as { nom?: unknown }[]).map((f) => String(f.nom ?? '')).filter(Boolean).join(', ')})` : '';
    return `- ${heure(l.created_at)} ${quoi} : ${String(l.message).replace(/\s+/g, ' ').slice(0, 300)}${fichiers}`;
  });
  return `STUDIO 3D — DERNIERS COMPTES RENDUS (exécutés dans le Studio, fait foi ; ne refais pas ce qui est fait, ne le redemande pas) :\n${lignesTexte.join('\n')}`;
}
