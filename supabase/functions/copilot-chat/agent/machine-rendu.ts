// supabase/functions/copilot-chat/agent/machine-rendu.ts
// =============================================================
// VIS-60 (27/11/2026) — état de la machine de rendu pour Mimmo, à partir du SIGNAL DE VIE (rpc `studio_machine_etat`,
// migration 20261127010000_vis60_signal_vie_machine.sql). Sans migration : null → copilot-chat garde etatMachine()
// (état déduit de la file, studio.ts). Même logique que le bandeau du site (src/lib/studio/etatMachineRendu.ts).
// BRANCHEMENT (studio.ts, non fait ici) : dans le devis, `machine_de_rendu: (await phraseMachineSignal(admin, maintenant)) ?? machine.phrase`.
// =============================================================
import { vueMachineRendu, type SignalMachine } from '../../../../src/lib/studio/etatMachineRendu.ts';

export async function lireSignalMachine(admin: { rpc: (n: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<SignalMachine | null> {
  try {
    const { data, error } = await admin.rpc('studio_machine_etat');
    if (error) return null;
    const l = Array.isArray(data) ? data[0] : data;
    return l && typeof (l as SignalMachine).vu_le === 'string' ? (l as SignalMachine) : null;
  } catch {
    return null;
  }
}

/** Phrase du devis / du suivi (null : pas de signal → garder l'état déduit). */
export function phraseMachineSignal(signal: SignalMachine | null, maintenant: number): string | null {
  if (!signal) return null;
  const v = vueMachineRendu({ signal, file: [], maintenant });
  return v.etat === 'hors_ligne'
    ? `${v.titre} Le rendu restera EN ATTENTE et démarrera automatiquement à son retour ; rien n’est débité tant qu’il n’a pas démarré.`
    : v.titre;
}
