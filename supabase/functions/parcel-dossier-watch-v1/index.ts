import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reparerEncodageProfond } from '../_shared/texte/reparerEncodage.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-dossier-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const cronSecret = Deno.env.get('DOSSIER_WATCH_CRON_SECRET') ?? '';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type Snapshot = Record<string, unknown>;
type WatchRow = { id: string; user_id: string; watch_enabled: boolean; watch_snapshot: Snapshot | null };

async function gpuLayer(layer: string, lat: number, lon: number): Promise<string[] | null> {
  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
  const res = await fetch(`https://apicarto.ign.fr/api/gpu/${layer}?geom=${geom}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  const payload = reparerEncodageProfond(await res.json());
  if (!Array.isArray(payload?.features)) return null;
  return [...new Set(payload.features.map((feature: unknown) => {
    const props = object(object(feature).properties);
    return string(props.libelle) ?? string(props.nomsuplitt) ?? string(props.nomass) ?? string(props.nom);
  }).filter((value: string | null): value is string => Boolean(value)))].sort();
}

async function taxRate(insee: string): Promise<{ rate: number; year: string } | null> {
  const base = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers-geo/records';
  const query = new URLSearchParams({ where: `insee_com="${insee}"`, select: 'taux_global_tfb,exercice', order_by: 'exercice DESC', limit: '1' });
  const res = await fetch(`${base}?${query}`, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) return null;
  const row = object((await res.json())?.results?.[0]);
  const rate = row.taux_global_tfb == null ? NaN : Number(row.taux_global_tfb);
  const year = string(row.exercice) ?? (typeof row.exercice === 'number' ? String(row.exercice) : null);
  return Number.isFinite(rate) && rate >= 0 && year ? { rate, year } : null;
}

async function observe(previous: Snapshot): Promise<{ current: Snapshot; unavailable: string[] }> {
  const point = object(previous.point);
  const lat = number(point.lat);
  const lon = number(point.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Coordonnées du point de suivi absentes ou invalides.');
  }
  const insee = string(previous.insee);
  const layers = ['zone-urba', 'prescription-surf', 'assiette-sup-s'] as const;
  const settled = await Promise.allSettled(layers.map((layer) => gpuLayer(layer, lat, lon)));
  const current: Snapshot = { ...previous };
  const unavailable: string[] = [];
  const fields = ['zone', 'prescriptions', 'servitudes'] as const;
  settled.forEach((item, index) => {
    const values = item.status === 'fulfilled' ? item.value : null;
    if (values === null) unavailable.push(fields[index]);
    else current[fields[index]] = index === 0 ? values[0] ?? null : values;
  });
  if (insee && /^\d{5}$/.test(insee)) {
    try {
      const tax = await taxRate(insee);
      if (tax) { current.taxRate = tax.rate; current.taxYear = tax.year; }
      else unavailable.push('taxRate');
    } catch { unavailable.push('taxRate'); }
  } else unavailable.push('taxRate');
  return { current, unavailable };
}

function changes(previous: Snapshot, current: Snapshot): Array<{ field: string; before: unknown; after: unknown }> {
  return ['zone', 'prescriptions', 'servitudes', 'taxRate', 'taxYear'].flatMap((field) => {
    const before = previous[field] ?? null;
    const after = current[field] ?? null;
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, before, after }];
  });
}

async function check(row: WatchRow, admin: ReturnType<typeof createClient>) {
  if (!row.watch_enabled) return { dossier_id: row.id, status: 'disabled', changes_count: 0 };
  const previous = object(row.watch_snapshot);
  const { current, unavailable } = await observe(previous);
  const detected = changes(previous, current);
  if (detected.length) {
    const bytes = new TextEncoder().encode(JSON.stringify({ before: previous, after: current, changes: detected }));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const eventHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await admin.from('copilot_parcel_dossier_events').upsert({
      dossier_id: row.id, user_id: row.user_id, event_hash: eventHash, changes: detected,
    }, { onConflict: 'dossier_id,event_hash', ignoreDuplicates: true });
    if (error) throw error;
  }
  const { error } = await admin.from('copilot_parcel_dossiers').update({
    watch_snapshot: current, checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', row.id).eq('watch_enabled', true);
  if (error) throw error;
  return { dossier_id: row.id, status: unavailable.length ? 'partial' : 'ok', changes_count: detected.length, unavailable };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response({ status: 'error', message: 'POST requis.' }, 405);
  if (!url || !anon || !service) return response({ status: 'error', message: 'Configuration serveur incomplète.' }, 503);
  let body: Record<string, unknown>;
  try { body = object(await req.json()); }
  catch { return response({ status: 'error', message: 'JSON invalide.' }, 400); }
  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (body.batch === true) {
    if (!cronSecret || req.headers.get('x-dossier-cron-secret') !== cronSecret) return response({ status: 'error', message: 'Accès refusé.' }, 403);
    const { data, error } = await admin.from('copilot_parcel_dossiers')
      .select('id, user_id, watch_enabled, watch_snapshot').eq('watch_enabled', true)
      .order('checked_at', { ascending: true, nullsFirst: true }).limit(100);
    if (error) return response({ status: 'error', message: error.message }, 500);
    const results = [];
    for (const row of data ?? []) {
      try { results.push(await check(row as WatchRow, admin)); }
      catch (error) { results.push({ dossier_id: row.id, status: 'error', message: error instanceof Error ? error.message : String(error) }); }
    }
    return response({ status: results.some((item) => item.status === 'error') ? 'partial' : 'ok', checked: results.length, results });
  }
  if (!uuid(body.dossier_id)) return response({ status: 'error', message: 'Identifiant de dossier invalide.' }, 400);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return response({ status: 'error', message: 'Authentification requise.' }, 401);
  const userDb = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await userDb.auth.getUser();
  if (authError || !auth.user) return response({ status: 'error', message: 'Authentification invalide.' }, 401);
  const { data: row, error } = await userDb.from('copilot_parcel_dossiers')
    .select('id, user_id, watch_enabled, watch_snapshot').eq('id', body.dossier_id).maybeSingle();
  if (error) return response({ status: 'error', message: error.message }, 500);
  if (!row || row.user_id !== auth.user.id) return response({ status: 'error', message: 'Dossier introuvable.' }, 404);
  try { return response(await check(row as WatchRow, admin)); }
  catch (failure) { return response({ status: 'error', message: failure instanceof Error ? failure.message : String(failure) }, 502); }
});
