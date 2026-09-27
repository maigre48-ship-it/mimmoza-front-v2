import { supabase } from '@/lib/supabaseClient';

export type FinessSupply = { status: 'ok' | 'partial' | 'unavailable'; communeInsee: string; items: { name: string; finess: string; city: string }[];
  sourceUrl: string; fetchedAt: string | null; message: string | null };

export async function fetchFinessSupply(insee: string): Promise<FinessSupply> {
  const empty = { status: 'unavailable' as const, communeInsee: insee, items: [],
    sourceUrl: 'https://ansforge.github.io/annuaire-sante-fhir-documentation/pages/guide/version-2/resources/organization.html', fetchedAt: null };
  try {
    const { data, error } = await supabase.functions.invoke('finess-supply-v1', { body: { communeInsee: insee } });
    if (error || !data || !['ok', 'partial'].includes(data.status) || data.communeInsee !== insee || !Array.isArray(data.items))
      return { ...empty, message: typeof data?.message === 'string' ? data.message : 'Annuaire Santé non accessible.' };
    const items = data.items.filter((item: unknown): item is { name: string; finess: string; city: string } => !!item && typeof item === 'object'
      && typeof (item as { name?: unknown }).name === 'string' && /^\d{9}$/.test(String((item as { finess?: unknown }).finess ?? '')));
    return { status: data.status, communeInsee: insee, items: items.slice(0, 100), sourceUrl: empty.sourceUrl,
      fetchedAt: typeof data.fetchedAt === 'string' ? data.fetchedAt : null, message: data.status === 'partial' ? 'Résultat partiel : la liste peut être incomplète.' : null };
  } catch { return { ...empty, message: 'Annuaire Santé momentanément indisponible.' }; }
}
