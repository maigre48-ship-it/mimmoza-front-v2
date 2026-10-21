// canalMetreStudio.ts — R5 : abonnement du Bilan au métré émis par Studio (même origine)
// ─────────────────────────────────────────────────────────────────────────────
// Transports écoutés (tous bornés à l'origine de la page) :
//   • BroadcastChannel « mimmoza-metre-v2 » (onglets et iframes de l'origine) ;
//   • window.postMessage (Studio ouvert par le Bilan ou intégré), origine vérifiée ;
//   • événement `storage` sur `mimmoza.metre.v2.*` (repli entre onglets).
// À l'ouverture : relecture du métré persistant de l'étude (aucune expiration),
// puis « demande » à Studio de réémettre — un Bilan ouvert après Studio, ou un
// premier message perdu, est donc rattrapé sans clic.
// Les API navigateur sont injectables (tests d'intégration en Node).
// ─────────────────────────────────────────────────────────────────────────────

import {
  CANAL_METRE, CLE_METRE_DERNIER, CLE_METRE_PREFIXE, cleMetreEtude, cleResume, lireMetreV2,
  type MetreStudioV2, type ResumeBilan,
} from "./metreStudio.ts";

export interface CanalLike {
  postMessage(m: unknown): void;
  addEventListener(t: "message", f: (e: { data: unknown }) => void): void;
  removeEventListener?(t: "message", f: (e: { data: unknown }) => void): void;
  close(): void;
}
interface StockageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
interface FenetreLike {
  location: { origin: string };
  opener?: unknown;
  addEventListener(t: string, f: (e: any) => void): void;
  removeEventListener(t: string, f: (e: any) => void): void;
}
export interface EnvCanal { canal: CanalLike | null; stockage: StockageLike | null; fenetre: FenetreLike | null }

export function envParDefaut(): EnvCanal {
  let stockage: StockageLike | null = null;
  try { stockage = typeof localStorage === "undefined" ? null : localStorage; } catch { stockage = null; }
  return {
    canal: typeof BroadcastChannel === "undefined" ? null : (new BroadcastChannel(CANAL_METRE) as unknown as CanalLike),
    stockage,
    fenetre: typeof window === "undefined" ? null : (window as unknown as FenetreLike),
  };
}

function lireStocke(stockage: StockageLike | null, cle: string): MetreStudioV2 | null {
  try {
    const brut = stockage?.getItem(cle);
    return brut && brut.length < 500_000 ? lireMetreV2(JSON.parse(brut)) : null;
  } catch { return null; }
}

/** Dernier métré persistant pour l'étude (ou, à défaut, le dernier métré non relié émis par Studio). */
export function lireMetrePersistant(studyId: string | null, stockage: StockageLike | null): { etude: MetreStudioV2 | null; dernier: MetreStudioV2 | null } {
  return { etude: studyId ? lireStocke(stockage, cleMetreEtude(studyId)) : null, dernier: lireStocke(stockage, CLE_METRE_DERNIER) };
}

/**
 * S'abonne au métré. `surMetre` reçoit chaque métré VALIDE (filtrage étude/lien
 * à la charge de l'appelant, qui connaît la liaison courante). Renvoie l'arrêt.
 */
export function ecouterMetreStudio(studyId: string | null, surMetre: (m: MetreStudioV2) => void, env: EnvCanal = envParDefaut(), possedeCanal = true): () => void {
  const origine = env.fenetre?.location.origin ?? null;
  const traiter = (data: unknown): void => {
    if (!data || typeof data !== "object") return;
    const o = data as Record<string, unknown>;
    if (o.canal !== CANAL_METRE || o.type !== "metre") return;
    const m = lireMetreV2(o.metre);
    if (m) surMetre(m);
  };
  const surCanal = (e: { data: unknown }): void => traiter(e.data);
  const surMessage = (e: { origin: string; data: unknown }): void => { if (origine && e.origin === origine) traiter(e.data); };
  const surStockage = (e: { key: string | null; newValue: string | null }): void => {
    if (!e.key?.startsWith(CLE_METRE_PREFIXE) || !e.newValue) return;
    try { const m = lireMetreV2(JSON.parse(e.newValue)); if (m) surMetre(m); } catch { /* ignoré */ }
  };
  env.canal?.addEventListener("message", surCanal);
  env.fenetre?.addEventListener("message", surMessage);
  env.fenetre?.addEventListener("storage", surStockage);
  // Rattrapage : Studio réémet son métré courant.
  try { env.canal?.postMessage({ canal: CANAL_METRE, type: "demande", etudeId: studyId, architectureId: null }); } catch { /* */ }
  return () => {
    env.canal?.removeEventListener?.("message", surCanal);
    env.fenetre?.removeEventListener("message", surMessage);
    env.fenetre?.removeEventListener("storage", surStockage);
    if (possedeCanal) { try { env.canal?.close(); } catch { /* */ } }
  };
}

/** Un métré v2 de ce modèle est-il déjà connu pour l'étude ? (l'instantané v1 lui cède alors la place) */
export function metreV2Present(studyId: string, architectureId: string, stockage: StockageLike | null = envParDefautStockage()): boolean {
  const { etude } = lireMetrePersistant(studyId, stockage);
  return !!etude && etude.architectureId === architectureId;
}
function envParDefautStockage(): StockageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Demande à Studio de relier son modèle à l'étude (il réémet aussitôt avec `etudeId`). */
export function demanderLiaison(etudeId: string, architectureId: string, env: EnvCanal = envParDefaut()): void {
  try { env.canal?.postMessage({ canal: CANAL_METRE, type: "lier", etudeId, architectureId }); } catch { /* */ }
}

/** Publie le résumé du bilan (mini-panneau Studio) : canal + stockage persistant. */
export function publierResumeBilan(resume: ResumeBilan, env: EnvCanal = envParDefaut()): void {
  try { env.stockage?.setItem(cleResume(resume.etudeId), JSON.stringify(resume)); } catch { /* quota */ }
  try { env.canal?.postMessage({ canal: CANAL_METRE, type: "resume", resume }); } catch { /* */ }
}
