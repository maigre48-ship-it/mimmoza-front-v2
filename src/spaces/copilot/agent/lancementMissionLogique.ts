// src/spaces/copilot/agent/lancementMissionLogique.ts
// =============================================================================
// VIS-21 (23/11/2026) — UNE SEULE action « Lancer la mission » (logique PURE, testée par node --test).
//
// Constat du fondateur (23/11) : sous la carte du devis (« Lancer la mission »), la carte « Votre parcours » montrait
// « Valider », qui envoyait « Lance la conception de mon projet sur ce terrain. » à Mimmo — Mimmo repartait pour
// reproposer une mission. Désormais la carte du devis, le panneau Espace 3D et la carte du parcours appellent la MÊME
// fonction (`lancerMissionAvec` → validerDevis = RPC agent_mission_valider_devis, mêmes jetons réservés), avec un
// verrou par mission : deux clics (carte + parcours) ne lancent jamais deux fois.
// =============================================================================
import type { Mission } from './agent.types';

export interface DepsLancement {
  /** validerDevis (agentApi) : RPC agent_mission_valider_devis. */
  valider: (missionId: string) => Promise<Mission | null>;
  /** useAgentUi.signalerChangement : toutes les cartes du devis relisent la mission (lancée / en cours). */
  signaler: () => void;
  /** Relecture du solde après la réservation faite par le moteur. */
  rafraichirSolde: () => void;
  planifier: (fn: () => void, ms: number) => void;
  /** Panneau Missions présent sur la page ? Alors il s'ouvre sur la mission. */
  suiviDisponible: () => boolean;
  ouvrirSuivi: (missionId: string) => void;
}

const enVol = new Map<string, Promise<Mission | null>>();

/** Lance le devis `missionId` (une seule fois même si deux boutons sont cliqués en même temps). */
export function lancerMissionAvec(missionId: string, d: DepsLancement): Promise<Mission | null> {
  const deja = enVol.get(missionId);
  if (deja) return deja;
  const p = (async () => {
    try {
      const m = await d.valider(missionId);
      d.signaler();
      // La réservation est faite par le moteur au démarrage : on relit le solde ensuite.
      d.planifier(() => d.rafraichirSolde(), 8000);
      if (d.suiviDisponible()) d.ouvrirSuivi(missionId);
      return m;
    } finally { enVol.delete(missionId); }
  })();
  enVol.set(missionId, p);
  return p;
}
