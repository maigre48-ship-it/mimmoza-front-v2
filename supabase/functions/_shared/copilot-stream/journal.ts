// supabase/functions/_shared/copilot-stream/journal.ts
// =============================================================================
// Journal structuré des échecs d'Edge Function dans `public.client_errors`
// (source = 'edge'). Lecture : page admin « Erreurs ».
//
// Ne lève JAMAIS et n'attend jamais plus de 3 s : un journal indisponible (table
// pas encore créée, base lente) ne doit pas dégrader la réponse à l'utilisateur.
// Aucune donnée saisie par l'utilisateur n'est écrite : ni question, ni texte
// de réponse, ni pièce jointe — seulement code, étape, durées et compteurs.
// =============================================================================

import { empreinteErreur } from './reprise.ts';

export interface EchecEdge {
  /** Nom de la fonction, ex. 'copilot-chat'. */
  fonction: string;
  /** Code court et stable : 'generation_interrompue', 'client_deconnecte'… */
  code: string;
  /** Étape où l'échec est survenu : 'preambule', 'generation', 'persistance'… */
  etape: string;
  /** Message technique (sans contenu utilisateur). */
  message: string;
  niveau?: 'error' | 'warning';
  userId?: string | null;
  dureeMs?: number;
  release?: string | null;
  /** Scalaires uniquement (mode, tier, compteurs…). */
  contexte?: Record<string, string | number | boolean | null | undefined>;
}

const borne = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** Ligne à insérer — fonction pure, testable. */
export function ligneEchecEdge(e: EchecEdge): Record<string, unknown> {
  const contexte: Record<string, unknown> = { code: e.code, etape: e.etape };
  if (typeof e.dureeMs === 'number') contexte.duree_ms = Math.round(e.dureeMs);
  for (const [k, v] of Object.entries(e.contexte ?? {})) {
    if (v === undefined) continue;
    contexte[k] = typeof v === 'string' ? borne(v, 200) : v;
  }
  const message = borne(`${e.code} — ${e.message || 'sans message'}`, 1000);
  return {
    source: 'edge',
    level: e.niveau ?? 'error',
    user_id: e.userId ?? null,
    route: `/functions/${e.fonction}`,
    message,
    stack: null,
    user_agent: null,
    release: e.release ?? null,
    context: contexte,
    fingerprint: empreinteErreur('edge', `${e.fonction}|${e.code}|${e.etape}|${e.message}`, null),
  };
}

type ClientInsertion = {
  from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }> };
};

export async function journaliserEchecEdge(client: ClientInsertion, e: EchecEdge): Promise<void> {
  try {
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.resolve(client.from('client_errors').insert(ligneEchecEdge(e))).then(({ error }) => {
        if (error) console.warn('[journal] client_errors indisponible :', (error as { message?: string }).message ?? error);
      }),
      new Promise<void>((resolve) => { minuteur = setTimeout(resolve, 3000); }),
    ]);
    clearTimeout(minuteur);
  } catch (err) {
    console.warn('[journal] échec du journal (ignoré)', err);
  }
}
