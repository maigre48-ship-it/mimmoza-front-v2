// src/components/routing/pageDifferee.ts
// =============================================================================
// Chargement différé des pages (React.lazy) avec préchargement à la demande.
//
// Chaque page de l'application devient un morceau JavaScript séparé, téléchargé
// seulement quand on l'ouvre. `precharger()` permet d'anticiper ce
// téléchargement (survol d'un lien, temps libre du navigateur).
//
// Après un nouveau déploiement, un onglet resté ouvert peut réclamer un morceau
// qui n'existe plus (noms de fichiers hachés). On recharge alors la page UNE
// fois pour récupérer la nouvelle version, au lieu d'afficher une erreur.
// =============================================================================

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Composant = ComponentType<any>;

export type PageDifferee<C extends Composant> = LazyExoticComponent<C> & {
  /** Lance le téléchargement du module sans l'afficher. Sans effet s'il est déjà chargé. */
  precharger: () => void;
};

const CLE_RECHARGEMENT = "mimmoza:rechargement-apres-deploiement";

function estErreurDeMorceau(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(
    message,
  );
}

/** Recharge la page une seule fois par session si un morceau a disparu (nouveau déploiement). */
function rechargerUneFois(): boolean {
  try {
    if (sessionStorage.getItem(CLE_RECHARGEMENT) === "1") return false;
    sessionStorage.setItem(CLE_RECHARGEMENT, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Déclare une page chargée à la demande.
 *
 *   const TarifsPage = differer(() => import("./pages/TarifsPage"), "default");
 *   const Deposer    = differer(() => import("./pages/DeposerPage"), "ApporteurDeposerPage");
 */
export function differer<M extends Record<K, Composant>, K extends keyof M & string>(
  charger: () => Promise<M>,
  nom: K,
): PageDifferee<M[K]> {
  let promesse: Promise<{ default: M[K] }> | null = null;

  const charge = (): Promise<{ default: M[K] }> => {
    if (!promesse) {
      promesse = charger().then(
        (module) => {
          try {
            sessionStorage.removeItem(CLE_RECHARGEMENT);
          } catch {
            /* stockage indisponible : sans conséquence */
          }
          const composant = module[nom];
          if (!composant) throw new Error(`Export « ${nom} » introuvable dans le module de page.`);
          return { default: composant };
        },
        (e: unknown) => {
          promesse = null; // autorise un nouvel essai
          if (estErreurDeMorceau(e) && rechargerUneFois()) {
            // La page se recharge : on ne résout jamais pour éviter un flash d'erreur.
            return new Promise<never>(() => {});
          }
          throw e;
        },
      );
    }
    return promesse;
  };

  const page = lazy(charge) as PageDifferee<M[K]>;
  page.precharger = () => {
    charge().catch(() => {
      /* le préchargement est opportuniste : l'erreur réapparaîtra à l'affichage */
    });
  };
  return page;
}
