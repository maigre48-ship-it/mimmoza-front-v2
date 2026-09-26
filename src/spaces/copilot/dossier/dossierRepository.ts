import { supabase } from '@/lib/supabaseClient';
import type { DossierParcel } from './parcelDossier';

export interface SavedParcelDossier {
  id: string;
  selectedParcels: DossierParcel[];
  builtSurfaceM2: number | null;
  cadastralRentPerM2: number | null;
  watchEnabled: boolean;
  checkedAt: string | null;
}

export interface DossierEvent {
  id: string;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  createdAt: string;
}

type DbRow = Record<string, unknown>;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;

export async function loadParcelDossier(conversationId: string, messageId: string): Promise<SavedParcelDossier | null> {
  const { data, error } = await supabase.from('copilot_parcel_dossiers')
    .select('id, selected_parcels, built_surface_m2, cadastral_rent_per_m2, watch_enabled, checked_at')
    .eq('conversation_id', conversationId).eq('source_message_id', messageId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as DbRow;
  return {
    id: String(row.id),
    selectedParcels: Array.isArray(row.selected_parcels) ? row.selected_parcels as DossierParcel[] : [],
    builtSurfaceM2: num(row.built_surface_m2),
    cadastralRentPerM2: num(row.cadastral_rent_per_m2),
    watchEnabled: row.watch_enabled === true,
    checkedAt: typeof row.checked_at === 'string' ? row.checked_at : null,
  };
}

export async function saveParcelDossier(input: {
  conversationId: string;
  messageId: string;
  selectedParcels: DossierParcel[];
  builtSurfaceM2: number | null;
  cadastralRentPerM2: number | null;
  watchEnabled: boolean;
  watchSnapshot?: Record<string, unknown> | null;
}): Promise<SavedParcelDossier> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Connectez-vous pour enregistrer le dossier.');
  const payload = {
    selected_parcels: input.selectedParcels,
    built_surface_m2: input.builtSurfaceM2,
    cadastral_rent_per_m2: input.cadastralRentPerM2,
    watch_enabled: input.watchEnabled,
    ...(input.watchSnapshot === undefined ? {} : { watch_snapshot: input.watchSnapshot }),
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: lookupError } = await supabase.from('copilot_parcel_dossiers')
    .select('id').eq('conversation_id', input.conversationId)
    .eq('source_message_id', input.messageId).maybeSingle();
  if (lookupError) throw lookupError;
  const query = existing
    ? supabase.from('copilot_parcel_dossiers').update(payload).eq('id', existing.id)
    : supabase.from('copilot_parcel_dossiers').insert({
        ...payload, user_id: user.id, conversation_id: input.conversationId,
        source_message_id: input.messageId,
      });
  const { data, error } = await query
    .select('id, selected_parcels, built_surface_m2, cadastral_rent_per_m2, watch_enabled, checked_at')
    .single();
  if (error) throw error;
  const row = data as DbRow;
  return {
    id: String(row.id), selectedParcels: input.selectedParcels,
    builtSurfaceM2: input.builtSurfaceM2,
    cadastralRentPerM2: input.cadastralRentPerM2,
    watchEnabled: input.watchEnabled,
    checkedAt: typeof row.checked_at === 'string' ? row.checked_at : null,
  };
}

export async function loadDossierEvents(dossierId: string): Promise<DossierEvent[]> {
  const { data, error } = await supabase.from('copilot_parcel_dossier_events')
    .select('id, changes, created_at, is_read').eq('dossier_id', dossierId)
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  if ((data ?? []).some((row: DbRow) => row.is_read !== true)) {
    const { error: markError } = await supabase.rpc('mark_copilot_parcel_dossier_events_read', { p_dossier_id: dossierId });
    if (markError) console.warn('[dossier] Impossible de marquer les alertes comme lues.', markError.message);
  }
  return (data ?? []).map((row: DbRow) => ({
    id: String(row.id),
    changes: Array.isArray(row.changes) ? row.changes as DossierEvent['changes'] : [],
    createdAt: String(row.created_at),
  }));
}
