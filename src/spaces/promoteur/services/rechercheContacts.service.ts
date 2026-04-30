import { supabase } from '@/lib/supabase';
import type {
  MairieContactRow,
  RechercheContactsQuery,
  RechercheContactsResponse,
} from '../types/rechercheContacts.types';

const EDGE_FUNCTION = 'recherche-contacts-mairies-v1';

function safeString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeRow(raw: unknown): MairieContactRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const commune = safeString(
    (r.commune as string) ??
      (r.nom_commune as string) ??
      (r.nomCommune as string) ??
      (r.ville as string),
  );
  if (!commune) return null;

  return {
    codeInsee: safeString(
      (r.codeInsee as string) ??
        (r.code_insee as string) ??
        (r.insee as string) ??
        (r.codeCommune as string) ??
        (r.code_commune as string),
    ),
    commune,
    codePostal: safeString(
      (r.codePostal as string) ??
        (r.code_postal as string) ??
        (r.cp as string),
    ),
    civiliteMaire: safeString(
      (r.civiliteMaire as string) ??
        (r.civilite_maire as string) ??
        (r.civilite as string),
    ),
    prenomMaire: safeString(
      (r.prenomMaire as string) ??
        (r.prenom_maire as string) ??
        (r.prenom as string),
    ),
    nomMaire: safeString(
      (r.nomMaire as string) ??
        (r.nom_maire as string) ??
        (r.nom as string),
    ),
    emailMairie: safeString(
      (r.emailMairie as string) ??
        (r.email_mairie as string) ??
        (r.email as string),
    ),
    telephoneMairie: safeString(
      (r.telephoneMairie as string) ??
        (r.telephone_mairie as string) ??
        (r.telephone as string) ??
        (r.tel as string),
    ),
    adresseMairie: safeString(
      (r.adresseMairie as string) ??
        (r.adresse_mairie as string) ??
        (r.adresse as string),
    ),
    source: safeString(r.source as string),
    distanceKm: safeNumber(
      (r.distanceKm as number) ?? (r.distance_km as number) ?? (r.distance as number),
    ),
  };
}

function normalizeResponse(data: unknown): RechercheContactsResponse {
  const container =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  const rawRows: unknown[] = Array.isArray(container.rows)
    ? (container.rows as unknown[])
    : Array.isArray(container.data)
    ? (container.data as unknown[])
    : Array.isArray(data)
    ? (data as unknown[])
    : [];

  const rows: MairieContactRow[] = [];
  for (const raw of rawRows) {
    const n = normalizeRow(raw);
    if (n) rows.push(n);
  }

  const totalRaw = container.total;
  const total =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw)
      ? totalRaw
      : rows.length;

  const source = safeString(container.source as string);
  const centerCommune = safeString(
    (container.centerCommune as string) ?? (container.center_commune as string),
  );
  const radiusKm = safeNumber(
    (container.radiusKm as number) ?? (container.radius_km as number),
  );

  return { rows, total, source, centerCommune, radiusKm };
}

export async function searchMairieContacts(
  query: RechercheContactsQuery,
): Promise<RechercheContactsResponse> {
  const q = (query?.query ?? '').trim();
  if (!q) {
    return { rows: [], total: 0, source: null, centerCommune: null, radiusKm: null };
  }

  const radius =
    typeof query.radiusKm === 'number' && Number.isFinite(query.radiusKm) && query.radiusKm > 0
      ? query.radiusKm
      : null;

  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION, {
      body: { query: q, radiusKm: radius },
    });

    if (error) {
      throw new Error(
        error.message ||
          'Le service de recherche des contacts mairies est indisponible.',
      );
    }

    return normalizeResponse(data);
  } catch (err: unknown) {
    if (err instanceof Error) throw err;
    throw new Error(
      'Erreur inattendue lors de la recherche des contacts mairies.',
    );
  }
}

// ── Enrichissement maires via table public.maires_rne ──────────────

type MaireDbRow = {
  code_insee: string | null;
  civilite: string | null;
  prenom: string | null;
  nom: string | null;
};

function formatMaireLabel(
  civilite: string | null,
  prenom: string | null,
  nom: string | null,
): { civilite: string | null; prenom: string | null; nom: string | null } {
  return {
    civilite: civilite && civilite.trim().length > 0 ? civilite.trim() : null,
    prenom: prenom && prenom.trim().length > 0 ? prenom.trim() : null,
    nom: nom && nom.trim().length > 0 ? nom.trim() : null,
  };
}

/**
 * Enrichit les lignes d'une réponse de recherche avec les maires présents dans
 * la table public.maires_rne.
 *
 * Comportement défensif :
 *  - une seule requête groupée (.in) avec déduplication des code_insee
 *  - si aucun code_insee disponible → retourne `rows` telles quelles
 *  - si la requête Supabase échoue → retourne `rows` telles quelles + log console
 *  - ne remplace JAMAIS un champ déjà renseigné par l'Edge Function : on enrichit
 *    uniquement les cellules nulles/vides
 */
export async function enrichRowsWithMaires(
  rows: MairieContactRow[],
): Promise<MairieContactRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const codeInseeSet = new Set<string>();
  for (const r of rows) {
    if (r.codeInsee && r.codeInsee.trim().length > 0) {
      codeInseeSet.add(r.codeInsee.trim());
    }
  }
  const codeInseeList = Array.from(codeInseeSet);
  if (codeInseeList.length === 0) return rows;

  try {
    const { data, error } = await supabase
      .from('maires_rne')
      .select('code_insee, civilite, prenom, nom')
      .in('code_insee', codeInseeList);

    if (error) {
      console.warn('[rechercheContacts] enrich maires failed:', error.message);
      return rows;
    }
    if (!Array.isArray(data) || data.length === 0) return rows;

    const byInsee = new Map<string, MaireDbRow>();
    for (const d of data as MaireDbRow[]) {
      if (d && typeof d.code_insee === 'string' && d.code_insee.trim().length > 0) {
        byInsee.set(d.code_insee.trim(), d);
      }
    }

    return rows.map((r) => {
      if (!r.codeInsee) return r;
      const m = byInsee.get(r.codeInsee);
      if (!m) return r;

      // Respect de l'existant : on n'écrase pas un champ déjà rempli
      const merged = formatMaireLabel(m.civilite, m.prenom, m.nom);
      return {
        ...r,
        civiliteMaire: r.civiliteMaire ?? merged.civilite,
        prenomMaire: r.prenomMaire ?? merged.prenom,
        nomMaire: r.nomMaire ?? merged.nom,
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[rechercheContacts] enrich maires unexpected error:', msg);
    return rows;
  }
}