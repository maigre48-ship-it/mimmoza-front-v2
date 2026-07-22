// ============================================================================
// MimmozIA — WelcomeGenerator (Phase 2, consommation du profil appris)
//
// Lit la vue `v_user_profile` (dérivée de user_events par la DB) et produit
// une personnalisation d'accueil. Principe NON négociable : précision > rappel.
// On ne dit rien tant qu'on n'est pas sûr → `tagline` reste null en cold-start.
//
// Emplacement conseillé : src/lib/mimmozia/useMimmozIAProfile.ts
//
// ⚠️ COUTURE À CONFIRMER : les NOMS DE COLONNES de v_user_profile. On lit
//    `select('*')` et on pioche de façon tolérante (top_cities / favorite_cities
//    / cities…). Envoie-moi la définition de la vue et je verrouille les noms.
// ============================================================================

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getLearningEnabled } from './track';

export interface MimmozIAProfile {
  derivedProfile: string | null; // 'promoteur' | 'investisseur' | 'particulier' | ...
  topCity?: string;
  topDepartment?: string;
  topStrategy?: string;
  topModule?: string;
  topPropertyType?: string;
  medianBudget?: number;
  medianSurface?: number;
  eventCount?: number;
}

// Lecture tolérante d'un "top" (tableau ['Bordeaux',...] ou chaîne "Bordeaux,Pau").
function firstOf(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (Array.isArray(v) && v.length > 0 && v[0] != null) return String(v[0]);
    if (typeof v === 'string' && v.trim()) return v.split(',')[0].trim();
  }
  return undefined;
}
function numOf(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return undefined;
}

const PROFILE_LABEL: Record<string, string> = {
  promoteur: 'promoteur',
  investisseur: 'investisseur',
  particulier: 'particulier',
  marchand: 'marchand de biens',
  rehabilitation: 'réhabilitation',
  apporteur: 'apporteur',
  banque: 'financeur',
};

/** Construit la phrase d'accueil. Renvoie null si rien de fiable à dire. */
function buildTagline(p: MimmozIAProfile | null): string | null {
  if (!p) return null;
  const bits: string[] = [];
  if (p.derivedProfile && PROFILE_LABEL[p.derivedProfile]) {
    bits.push(`Profil ${PROFILE_LABEL[p.derivedProfile]}`);
  }
  if (p.topCity) bits.push(`vous suivez surtout ${p.topCity}`);
  else if (p.topDepartment) bits.push(`secteur ${p.topDepartment}`);
  if (bits.length === 0) return null;
  // Majuscule initiale + point final.
  const s = bits.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

export function useMimmozIAProfile() {
  const [profile, setProfile] = useState<MimmozIAProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // Opt-out : apprentissage coupé ⇒ aucune personnalisation apprise.
        if (!(await getLearningEnabled())) {
          if (alive) { setProfile(null); setLoading(false); }
          return;
        }
        const { data } = await supabase
          .from('v_user_profile')
          .select('*')
          .maybeSingle(); // RLS → au plus la ligne de l'utilisateur courant
        if (!alive) return;

        if (!data) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const row = data as Record<string, unknown>;
        setProfile({
          derivedProfile: (row.derived_profile as string | null) ?? null,
          topCity: firstOf(row, ['top_cities', 'favorite_cities', 'fav_cities', 'cities']),
          topDepartment: firstOf(row, ['top_departments', 'favorite_departments', 'fav_departments', 'departments']),
          topStrategy: firstOf(row, ['top_strategies', 'favorite_strategies', 'fav_strategies', 'strategies']),
          topModule: firstOf(row, ['top_modules', 'favorite_modules', 'fav_modules', 'modules']),
          topPropertyType: firstOf(row, ['top_property_types', 'favorite_property_types', 'property_types']),
          medianBudget: numOf(row, ['median_budget', 'budget_median']),
          medianSurface: numOf(row, ['median_surface', 'surface_median']),
          eventCount: numOf(row, ['event_count', 'events_count', 'n_events']),
        });
        setLoading(false);
      } catch {
        if (alive) { setProfile(null); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, []);

  return { profile, tagline: buildTagline(profile), loading };
}