import { corsHeaders } from '../_shared/cors.ts';
import { parseEhpadOrganizations } from './parse.ts';

const headers = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ status: 'error', message: 'Méthode non autorisée.' }, 405);
  try {
    const { communeInsee } = await req.json() as { communeInsee?: string };
    if (!communeInsee || !/^(?:\d{5}|2[AB]\d{3})$/.test(communeInsee)) return json({ status: 'error', message: 'Code INSEE invalide.' }, 400);
    const key = Deno.env.get('ANS_FHIR_API_KEY');
    if (!key) return json({ status: 'unavailable', message: 'Accès à l’Annuaire Santé non configuré.' });
    const communeResponse = await fetch(`https://geo.api.gouv.fr/communes/${communeInsee}?fields=code,nom,codesPostaux`, { signal: AbortSignal.timeout(8000) });
    if (!communeResponse.ok) return json({ status: 'unavailable', message: 'Commune non vérifiée.' });
    const commune = await communeResponse.json() as { code?: string; nom?: string; codesPostaux?: string[] };
    if (commune.code !== communeInsee || !commune.nom || !Array.isArray(commune.codesPostaux)) return json({ status: 'unavailable', message: 'Commune non vérifiée.' });
    const items = new Map<string, { name: string; finess: string; city: string }>();
    let complete = true;
    for (const postalCode of commune.codesPostaux.slice(0, 5)) {
      if (!/^\d{5}$/.test(postalCode)) continue;
      const url = new URL('https://gateway.api.esante.gouv.fr/fhir/v2/Organization');
      url.searchParams.set('address-postalcode', postalCode);
      url.searchParams.set('data-information-system', 'FINESS');
      url.searchParams.set('active', 'true');
      url.searchParams.set('type', 'https://mos.esante.gouv.fr/NOS/TRE_R66-CategorieEtablissement/FHIR/TRE-R66-CategorieEtablissement|500');
      url.searchParams.set('_count', '100');
      const response = await fetch(url, { headers: { 'ESANTE-API-KEY': key, Accept: 'application/fhir+json' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json({ status: 'unavailable', message: 'Annuaire Santé temporairement indisponible.' });
      const parsed = parseEhpadOrganizations(await response.json(), commune.nom);
      if (!parsed) return json({ status: 'unavailable', message: 'Réponse FINESS non exploitable.' });
      complete &&= parsed.complete;
      for (const item of parsed.items) items.set(item.finess, item);
    }
    return json({ status: complete ? 'ok' : 'partial', communeInsee, items: [...items.values()].slice(0, 100),
      fetchedAt: new Date().toISOString(), sourceUrl: 'https://ansforge.github.io/annuaire-sante-fhir-documentation/pages/guide/version-2/resources/organization.html',
      note: 'Structures EHPAD actives de la commune : ce dénombrement ne fournit ni places autorisées ni taux d’occupation.' });
  } catch { return json({ status: 'unavailable', message: 'Annuaire Santé momentanément indisponible.' }); }
});
