// =============================================================
// Mimmoza · Veille active — service front (CRUD veilles + fil d'événements)
// S'appuie sur les tables opportunity_watches / _events (RLS par user).
// =============================================================

import { supabase } from '@/lib/supabase';
import type { OpportunityStrategy, OpportunityAssetType } from './opportunityEngine.types';

export interface WatchCriteria {
  assetType?: OpportunityAssetType | 'all';
  priceMin?: number | null;
  priceMax?: number | null;
  surfaceMin?: number | null;
  surfaceMax?: number | null;
}

export interface OpportunityWatch {
  id: string;
  user_id: string;
  label: string;
  city: string | null;
  zip_code: string | null;
  strategy: OpportunityStrategy;
  criteria: WatchCriteria;
  min_score: number;
  frequency: 'daily' | 'weekly';
  notify_inapp: boolean;
  notify_email: boolean;
  active: boolean;
  last_run_at: string | null;
  max_listings: number;
  created_at: string;
  updated_at: string;
}

export type WatchEventType = 'new_listing' | 'price_drop' | 'strong_opportunity';

export interface WatchEvent {
  id: string;
  watch_id: string;
  user_id: string;
  event_type: WatchEventType;
  listing_key: string;
  url: string | null;
  title: string | null;
  price: number | null;
  previous_price: number | null;
  price_delta_pct: number | null;
  score: number | null;
  payload: Record<string, unknown> | null;
  seen: boolean;
  created_at: string;
}

export interface CreateWatchInput {
  label: string;
  city?: string | null;
  zipCode?: string | null;
  strategy: OpportunityStrategy;
  criteria?: WatchCriteria;
  minScore?: number;
  frequency?: 'daily' | 'weekly';
  notifyInapp?: boolean;
  notifyEmail?: boolean;
  maxListings?: number;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error('Utilisateur non authentifié.');
  return data.user.id;
}

export async function createWatch(input: CreateWatchInput): Promise<OpportunityWatch> {
  const userId = await currentUserId();
  const zip = input.zipCode?.trim() || null;
  const city = input.city?.trim() || null;
  if (!zip && !city) throw new Error('Renseigne au moins une ville ou un code postal.');

  const row = {
    user_id: userId,
    label: input.label.trim() || `Veille ${city ?? zip}`,
    city,
    zip_code: zip,
    strategy: input.strategy,
    criteria: input.criteria ?? {},
    min_score: input.minScore ?? 65,
    frequency: input.frequency ?? 'daily',
    notify_inapp: input.notifyInapp ?? true,
    notify_email: input.notifyEmail ?? false,
    max_listings: Math.max(1, Math.min(500, Math.round(input.maxListings ?? 100))),
    active: true,
  };

  const { data, error } = await supabase
    .from('opportunity_watches')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as OpportunityWatch;
}

export async function listWatches(): Promise<OpportunityWatch[]> {
  const { data, error } = await supabase
    .from('opportunity_watches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as OpportunityWatch[];
}

export async function updateWatch(
  id: string,
  patch: Partial<Pick<OpportunityWatch, 'label' | 'active' | 'frequency' | 'min_score' | 'notify_email' | 'notify_inapp' | 'max_listings' | 'criteria'>>,
): Promise<void> {
  const { error } = await supabase.from('opportunity_watches').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function toggleWatchActive(id: string, active: boolean): Promise<void> {
  return updateWatch(id, { active });
}

export async function deleteWatch(id: string): Promise<void> {
  const { error } = await supabase.from('opportunity_watches').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface ListEventsParams {
  unseenOnly?: boolean;
  watchId?: string;
  limit?: number;
}

export async function listEvents(params?: ListEventsParams): Promise<WatchEvent[]> {
  let q = supabase
    .from('opportunity_watch_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(params?.limit ?? 100);
  if (params?.unseenOnly) q = q.eq('seen', false);
  if (params?.watchId) q = q.eq('watch_id', params.watchId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as WatchEvent[];
}

export async function countUnseen(): Promise<number> {
  const { count, error } = await supabase
    .from('opportunity_watch_events')
    .select('id', { count: 'exact', head: true })
    .eq('seen', false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markEventSeen(id: string): Promise<void> {
  const { error } = await supabase.from('opportunity_watch_events').update({ seen: true }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markAllEventsSeen(): Promise<void> {
  const { error } = await supabase
    .from('opportunity_watch_events')
    .update({ seen: true })
    .eq('seen', false);
  if (error) throw new Error(error.message);
}

/** Lance le run d'une veille immédiatement (Edge Function en force). */
export async function runWatchNow(watchId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('opportunity-watch-run', {
    body: { watch_id: watchId, force: true },
  });
  if (error) throw new Error(error.message);
}