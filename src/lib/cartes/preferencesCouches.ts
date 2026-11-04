// src/lib/cartes/preferencesCouches.ts
//
// Mémorisation du choix de couches (fond, cadastre, opacité) et suivi des
// erreurs de tuiles pour le repli automatique Satellite → Plan.
//
// Logique pure (testée par node --test) : le stockage est injecté. En
// production c'est `userStorage` (src/lib/storage/userScopedStorage.ts), qui
// préfixe les clés par utilisateur ; ce module ne l'importe pas pour rester
// exécutable sous Node sans alias « @/ ».

import {
  OPACITE_CADASTRE_MAX,
  OPACITE_CADASTRE_MIN,
  OPACITE_CADASTRE_PAS,
  PREFERENCES_PAR_DEFAUT,
  type ContexteCarte,
  type FondCarte,
  type PreferencesCouches,
} from "./couchesIgn.ts";

/** Sous-ensemble de Storage / userStorage dont on a besoin. */
export type StockageCles = {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
};

/** Clé de base (userStorage y ajoute le préfixe utilisateur). */
export function clePreferencesCouches(contexte: ContexteCarte): string {
  return `mimmoza.cartes.couches.${contexte}.v1`;
}

/** Borne et arrondit l'opacité du cadastre au pas du curseur. */
export function bornerOpacite(valeur: unknown, defaut: number = PREFERENCES_PAR_DEFAUT.parcelle.opaciteCadastre): number {
  const n = typeof valeur === "number" ? valeur : typeof valeur === "string" && valeur.trim() !== "" ? Number(valeur) : NaN;
  if (!Number.isFinite(n)) return defaut;
  const borne = Math.min(OPACITE_CADASTRE_MAX, Math.max(OPACITE_CADASTRE_MIN, n));
  const arrondi = Math.round(borne / OPACITE_CADASTRE_PAS) * OPACITE_CADASTRE_PAS;
  return Number(arrondi.toFixed(2));
}

function estFond(v: unknown): v is FondCarte {
  return v === "satellite" || v === "plan";
}

/**
 * Transforme une valeur quelconque (JSON relu, ancienne version…) en
 * préférences valides ; chaque champ invalide reprend la valeur par défaut.
 */
export function normaliserPreferences(brut: unknown, defaut: PreferencesCouches): PreferencesCouches {
  const o = brut && typeof brut === "object" ? (brut as Record<string, unknown>) : {};
  return {
    fond: estFond(o.fond) ? o.fond : defaut.fond,
    cadastre: typeof o.cadastre === "boolean" ? o.cadastre : defaut.cadastre,
    opaciteCadastre: bornerOpacite(o.opaciteCadastre, defaut.opaciteCadastre),
  };
}

export function preferencesParDefaut(contexte: ContexteCarte): PreferencesCouches {
  return { ...PREFERENCES_PAR_DEFAUT[contexte] };
}

/** Relit les préférences ; jamais d'exception (JSON abîmé, stockage refusé). */
export function lirePreferences(stockage: StockageCles | null | undefined, contexte: ContexteCarte): PreferencesCouches {
  const defaut = preferencesParDefaut(contexte);
  if (!stockage) return defaut;
  try {
    const texte = stockage.getItem(clePreferencesCouches(contexte));
    if (!texte) return defaut;
    return normaliserPreferences(JSON.parse(texte), defaut);
  } catch {
    return defaut;
  }
}

/** Écrit les préférences (normalisées) ; silencieux en cas d'échec. */
export function ecrirePreferences(
  stockage: StockageCles | null | undefined,
  contexte: ContexteCarte,
  prefs: PreferencesCouches,
): void {
  if (!stockage) return;
  try {
    const propre = normaliserPreferences(prefs, preferencesParDefaut(contexte));
    stockage.setItem(clePreferencesCouches(contexte), JSON.stringify(propre));
  } catch {
    /* quota ou accès refusé : on garde le choix en mémoire seulement */
  }
}

// ── Suivi des tuiles et repli ────────────────────────────────────────────────

export type SuiviTuiles = {
  chargees: number;
  erreurs: number;
  /** Vrai quand la couche est jugée indisponible (seuil atteint). */
  enPanne: boolean;
};

/** Nombre minimal d'erreurs avant de déclarer une couche en panne. */
export const SEUIL_ERREURS_PANNE = 4;

export function suiviInitial(): SuiviTuiles {
  return { chargees: 0, erreurs: 0, enPanne: false };
}

/**
 * Enregistre le résultat d'une tuile. La couche passe « en panne » quand au
 * moins SEUIL_ERREURS_PANNE tuiles ont échoué ET que les échecs sont
 * majoritaires (une ou deux tuiles manquantes en bord de couverture ne
 * déclenchent rien). Une fois en panne, l'état reste figé jusqu'à
 * réinitialisation (nouveau choix explicite de l'utilisateur).
 */
export function enregistrerTuile(etat: SuiviTuiles, reussie: boolean): SuiviTuiles {
  if (etat.enPanne) return etat;
  const chargees = etat.chargees + (reussie ? 1 : 0);
  const erreurs = etat.erreurs + (reussie ? 0 : 1);
  return { chargees, erreurs, enPanne: erreurs >= SEUIL_ERREURS_PANNE && erreurs > chargees };
}

/** Fond réellement affiché : le plan remplace le satellite en panne. */
export function fondEffectif(choix: FondCarte, satelliteEnPanne: boolean): FondCarte {
  return choix === "satellite" && satelliteEnPanne ? "plan" : choix;
}
