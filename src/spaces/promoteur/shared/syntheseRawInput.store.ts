// =============================================================================
// SNAPSHOT BILAN → SYNTHÈSE — lecture et écriture scopées par étude
// =============================================================================
//
// Le bug corrigé
// --------------
// Le Bilan promoteur écrivait ses chiffres sous une clé UNIQUE et GLOBALE
// (`mimmoza.promoteur.synthese.rawInput.v1`), que la page Synthèse relisait en
// PREMIÈRE priorité. Enchaîner « ouvrir l'étude A → Bilan → ouvrir l'étude B →
// Synthèse » affichait donc le CA, la marge, le coût travaux, le prix de vente
// au m² et la surface de terrain de l'étude A dans la synthèse de l'étude B.
// Aucun garde-fou ne le signalait : ni identifiant d'étude dans la charge
// utile, ni date d'écriture vérifiée.
//
// Ironie de la situation : le repli `rawInputFromStudy` de la page Synthèse
// reconstruit correctement les chiffres depuis des clés déjà scopées
// (`mimmoza.bilan.assumptions.<studyId>`), mais il n'était consulté qu'en
// SECOND. Le snapshot figé et non scopé gagnait donc sur le recalcul juste.
//
// La correction
// -------------
// 1. La charge utile est enveloppée : elle porte désormais son `studyId` et sa
//    date d'écriture.
// 2. Elle est écrite sous une clé scopée `…rawInput.v1.<studyId>`.
// 3. La clé historique reste écrite pour les sessions sans étude active, mais
//    elle n'est acceptée à la lecture que si son `studyId` correspond.
//
// Conséquence assumée : un snapshot écrit AVANT ce correctif (format nu, sans
// identifiant) est ignoré dès qu'une étude est active. La page retombe alors
// sur `rawInputFromStudy`, qui recalcule depuis les clés scopées. Recalculer
// coûte moins cher que d'afficher les chiffres d'une autre opération.
// =============================================================================

import { userStorage } from '@/lib/storage/userScopedStorage';

/** Clé historique, non scopée. Conservée pour les sessions sans étude active. */
export const SYNTHESE_RAW_KEY = 'mimmoza.promoteur.synthese.rawInput.v1';

/** Clé réellement utilisée dès qu'une étude est active. */
export function syntheseRawKey(studyId: string | null | undefined): string {
  return studyId ? `${SYNTHESE_RAW_KEY}.${studyId}` : SYNTHESE_RAW_KEY;
}

interface Envelope<T> {
  /** Étude à laquelle ces chiffres appartiennent. */
  studyId: string | null;
  /** Date d'écriture ISO, pour le diagnostic. */
  savedAt: string;
  input: T;
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return 'input' in v && 'studyId' in v && typeof v.savedAt === 'string';
}

/**
 * Enregistre les chiffres du Bilan à destination de la Synthèse.
 * Écrit la clé scopée, et la clé historique en miroir.
 */
export function writeSyntheseRawInput<T>(studyId: string | null | undefined, input: T): void {
  const envelope: Envelope<T> = {
    studyId: studyId ?? null,
    savedAt: new Date().toISOString(),
    input,
  };
  const payload = JSON.stringify(envelope);

  try {
    userStorage.setItem(syntheseRawKey(studyId), payload);
  } catch (e) {
    console.warn('[Bilan→Synthèse] écriture scopée impossible :', e);
  }

  // Miroir sur la clé historique : elle sert encore aux sessions ouvertes sans
  // étude active. Elle porte le même `studyId`, ce qui permet à la lecture de
  // refuser un snapshot appartenant à une autre opération.
  if (studyId) {
    try {
      userStorage.setItem(SYNTHESE_RAW_KEY, payload);
    } catch {
      /* la clé scopée fait foi, ce miroir est optionnel */
    }
  }
}

/**
 * Relit les chiffres du Bilan pour l'étude demandée.
 *
 * Retourne `null` — et non les chiffres d'une autre étude — dans tous les cas
 * douteux : snapshot d'une autre opération, ou format antérieur au correctif
 * dont l'appartenance ne peut pas être prouvée. L'appelant doit alors se
 * rabattre sur son recalcul depuis les clés scopées.
 */
export function readSyntheseRawInput<T>(studyId: string | null | undefined): T | null {
  // 1. Clé scopée : sans ambiguïté possible.
  if (studyId) {
    const scoped = parse<T>(userStorage.getItem(syntheseRawKey(studyId)));
    if (scoped && isEnvelope<T>(scoped)) return scoped.input;
  }

  // 2. Clé historique : acceptée seulement si elle prouve son appartenance.
  const legacy = parse<T>(userStorage.getItem(SYNTHESE_RAW_KEY));
  if (!legacy) return null;

  if (isEnvelope<T>(legacy)) {
    if ((legacy.studyId ?? null) === (studyId ?? null)) return legacy.input;
    console.debug(
      `[Bilan→Synthèse] snapshot ignoré : il appartient à l'étude ${legacy.studyId ?? '—'}, ` +
        `l'étude courante est ${studyId ?? '—'}.`,
    );
    return null;
  }

  // 3. Format antérieur au correctif (charge utile nue, sans identifiant).
  //    Toléré uniquement hors étude, là où il n'y a rien à confondre.
  if (!studyId) return legacy as T;

  console.debug(
    '[Bilan→Synthèse] snapshot au format historique ignoré : appartenance à ' +
      "l'étude courante non vérifiable. Recalcul depuis les clés scopées.",
  );
  return null;
}

/** Efface le snapshot d'une étude, et le miroir historique s'il lui appartient. */
export function clearSyntheseRawInput(studyId: string | null | undefined): void {
  try {
    userStorage.removeItem(syntheseRawKey(studyId));
  } catch {
    /* rien à faire */
  }
  if (!studyId) return;
  const legacy = parse<unknown>(userStorage.getItem(SYNTHESE_RAW_KEY));
  if (legacy && isEnvelope(legacy) && legacy.studyId === studyId) {
    try {
      userStorage.removeItem(SYNTHESE_RAW_KEY);
    } catch {
      /* rien à faire */
    }
  }
}

function parse<T>(raw: string | null): Envelope<T> | T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Envelope<T> | T;
  } catch {
    return null;
  }
}
