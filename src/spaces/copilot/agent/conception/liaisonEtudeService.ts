import { supabase } from '@/lib/supabaseClient';
import { PromoteurStudyService } from '@/spaces/promoteur/shared/promoteurStudyService';
import type { DepotLiaison } from './liaisonEtude';
const erreur = (message: string) => new Error('Liaison à l’étude indisponible. Le service doit être activé ou rétabli. Vous pouvez ouvrir l’atelier sans synchronisation au bilan. (' + message + ')');
export const depotLiaisonEtude: DepotLiaison = {
  async lister() {
    const r = await PromoteurStudyService.listStudies();
    if (!r.ok) throw erreur(r.error);
    return r.data.map(e => ({ id: e.id, title: [e.title, e.foncier?.commune_insee].filter(Boolean).join(" · "), archivee: e.status === 'archived' }));
  },
  async lire(conceptionId) {
    const { data, error } = await supabase.from('agent_conception_etude').select('etude_id').eq('conception_id', conceptionId).maybeSingle();
    if (error) throw erreur(error.message);
    return data?.etude_id ?? null;
  },
  async enregistrer(conceptionId, etudeId) {
    const { error } = await supabase.rpc('lier_conception_etude', { p_conception_id: conceptionId, p_etude_id: etudeId });
    if (error) throw erreur(error.message);
  },
};
