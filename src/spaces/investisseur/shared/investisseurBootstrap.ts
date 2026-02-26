import { getInvestisseurSnapshot } from "./investisseurSnapshot.store";

export function bootInvestisseurSnapshot(): void {
  try {
    const snap = getInvestisseurSnapshot();
    // log DEV utile
    console.log("[Investisseur] snapshot ready:", {
      activeProjectId: snap.activeProjectId,
      projects: Object.keys(snap.projects),
      updatedAt: snap.updatedAt,
    });
  } catch (e) {
    console.warn("[Investisseur] boot failed:", e);
  }
}
