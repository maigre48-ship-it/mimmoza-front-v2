export type FinessItem = { name: string; finess: string; city: string };
export type FinessParsed = { items: FinessItem[]; complete: boolean };

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function parseEhpadOrganizations(raw: unknown, communeName: string): FinessParsed | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bundle = raw as Record<string, unknown>;
  const entries = Array.isArray(bundle.entry) ? bundle.entry : bundle.total === 0 ? [] : null;
  if (bundle.resourceType !== 'Bundle' || !entries) return null;
  const items: FinessItem[] = [];
  for (const entry of entries) {
    const resource = entry && typeof entry === 'object' ? (entry as { resource?: Record<string, unknown> }).resource : null;
    if (!resource || resource.resourceType !== 'Organization' || resource.active !== true) continue;
    const codes = Array.isArray(resource.type) ? resource.type.flatMap((type) => type && typeof type === 'object' && Array.isArray((type as { coding?: unknown }).coding)
      ? (type as { coding: { code?: string; system?: string }[] }).coding : []) : [];
    if (!codes.some((coding) => coding.code === '500' && coding.system?.includes('TRE_R66-CategorieEtablissement'))) continue;
    const address = Array.isArray(resource.address) ? resource.address[0] as { city?: string } | undefined : undefined;
    const city = typeof address?.city === 'string' ? address.city : '';
    if (!city || normalize(city) !== normalize(communeName)) continue;
    const identifiers = Array.isArray(resource.identifier) ? resource.identifier as { system?: string; value?: string }[] : [];
    const finess = identifiers.find((identifier) => identifier.system?.toLowerCase().includes('finess') && /^\d{9}$/.test(identifier.value ?? ''))?.value;
    if (!finess || typeof resource.name !== 'string') continue;
    if (!items.some((item) => item.finess === finess)) items.push({ finess, name: resource.name.slice(0, 120), city });
  }
  const total = typeof bundle.total === 'number' && Number.isInteger(bundle.total) ? bundle.total : null;
  const links = Array.isArray(bundle.link) ? bundle.link as { relation?: string }[] : [];
  return { items, complete: total != null && total <= entries.length && !links.some((link) => link.relation === 'next') };
}
