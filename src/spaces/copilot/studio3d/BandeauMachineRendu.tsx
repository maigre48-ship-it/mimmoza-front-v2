/**
 * VIS-60 — bandeau « machine de rendu » de l'Espace 3D : « Machine de rendu hors ligne depuis … » (durée juste, horloge
 * du serveur), le client est prévenu que son travail ATTEND et qu'il n'est pas débité tant que le rendu n'a pas démarré.
 * Source : rpc `studio_machine_etat` (migration 20261127010000) ; sans elle, état DÉDUIT des travaux du client.
 * Ne s'affiche que s'il y a quelque chose d'utile à dire (machine hors ligne / incertaine, ou un travail en attente).
 * Composant autonome : ne touche ni aux cartes de film ni au suivi des rendus (autre agent).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { vueMachineRendu, type SignalMachine, type TravailFile, type VueMachineRendu } from '@/lib/studio/etatMachineRendu';
import './DossierClient.css';

const RAFRAICHIR_MS = 30_000;

async function lireSignal(): Promise<SignalMachine | null> {
  const { data, error } = await supabase.rpc('studio_machine_etat');
  if (error) return null; // migration non appliquée : repli sur la déduction
  const ligne = Array.isArray(data) ? data[0] : data;
  return ligne && typeof ligne.vu_le === 'string' ? (ligne as SignalMachine) : null;
}

async function lireFile(conversationId: string): Promise<(TravailFile & { type?: string })[]> {
  const { data } = await supabase.from('studio_jobs').select('type,statut,cree_le,demarre_le,maj_le,termine_le')
    .eq('conversation_id', conversationId).order('cree_le', { ascending: false }).limit(30);
  return (data ?? []) as (TravailFile & { type?: string })[];
}

export function BandeauMachineRendu({ conversationId, toujours = false }: { conversationId: string; toujours?: boolean }) {
  const [vue, setVue] = useState<VueMachineRendu | null>(null);
  useEffect(() => {
    let actif = true;
    const maj = async () => {
      const [signal, file] = await Promise.all([lireSignal(), lireFile(conversationId)]);
      const derniere = file.map((t) => t.maj_le ?? t.termine_le ?? t.demarre_le ?? null).filter((x): x is string => !!x).sort().pop() ?? null;
      if (actif) setVue(vueMachineRendu({ signal, file, derniereActiviteFile: derniere, maintenant: Date.now() }));
    };
    void maj();
    const id = window.setInterval(() => { void maj(); }, RAFRAICHIR_MS);
    return () => { actif = false; window.clearInterval(id); };
  }, [conversationId]);

  if (!vue) return null;
  const utile = toujours || vue.messageClient !== null || vue.etat === 'hors_ligne' || vue.etat === 'degradee';
  if (!utile) return null;
  return (
    <div className={`mz-machine is-${vue.etat}`} role="status" aria-live="polite">
      <p className="mz-machine__titre">{vue.titre}</p>
      {vue.messageClient ? <p className="mz-machine__client">{vue.messageClient}</p> : null}
    </div>
  );
}

export default BandeauMachineRendu;
