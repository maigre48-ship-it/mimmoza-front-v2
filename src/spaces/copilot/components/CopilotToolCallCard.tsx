// src/spaces/copilot/components/CopilotToolCallCard.tsx
import { AlertTriangle, Check, Info, Loader2, Wrench } from 'lucide-react';
import type { ActiveToolCall } from '../types/copilot.types';
import { COPILOT_THEME as T } from './copilotTheme';

// Libellés lisibles. La table ne couvrait que 6 outils sur les 34 réellement
// appelés : une conversation mélangeait « Comparables DVF » et
// `get_monuments_historiques`, ce qui donnait l'impression que certains outils
// étaient moins finis que d'autres. Liste établie sur les noms présents en base.
//
// Un nom absent d'ici s'affiche brut — c'est le repli voulu, pas une panne :
// mieux vaut un nom technique qu'une carte anonyme.
const TOOL_LABELS: Record<string, string> = {
  // Parcelle et urbanisme
  get_parcel_summary:              'Résumé parcelle',
  get_etude_parcelle:              'Étude parcelle',
  get_parcel_plu:                  'Règles PLU',
  get_zonage_plu:                  'Zonage PLU',
  get_zonage_abc:                  'Zonage ABC',
  get_prescriptions_urbanisme:     'Prescriptions d’urbanisme',
  get_servitudes:                  'Servitudes',
  get_monuments_historiques:       'Monuments historiques',
  get_altimetrie:                  'Altimétrie',
  get_assainissement:              'Assainissement',
  get_classement_sonore:           'Classement sonore',

  // Marché et valeur
  get_quick_market_insight:        'Analyse marché',
  get_etude_marche:                'Étude de marché',
  get_dvf_comparables:             'Comparables DVF',
  get_loyers_reference:            'Loyers de référence',
  get_taxes_locales:               'Fiscalité locale',
  recherche_biens:                 'Recherche de biens',

  // Risques et bâti
  get_risks_georisques:            'Risques Géorisques',
  get_ppr_detail:                  'Détail PPR',
  get_dpe_ademe:                   'DPE ADEME',
  get_batiment_bdnb:               'Bâtiment BDNB',
  get_sitadel:                     'Permis Sitadel',

  // Coûts
  get_couts_construction:          'Coûts de construction',
  get_couts_renovation:            'Coûts de rénovation',

  // Scoring
  compute_smartscore:              'SmartScore',

  // Veille et watchlists
  creer_zone_veille:               'Création zone de veille',
  desactiver_zone_veille:          'Désactivation zone de veille',
  lister_zones_veille:             'Zones de veille',
  creer_watchlist:                 'Création watchlist',
  lister_watchlists:               'Watchlists',
  creer_veille_appels_offres:      'Création veille appels d’offres',
  lister_veilles_appels_offres:    'Veilles appels d’offres',
  lister_nouveautes_appels_offres: 'Nouveaux appels d’offres',
  get_appels_offres:               'Appels d’offres',
};

function statusVisual(status: string) {
  if (status === 'running')
    return { icon: Loader2,        color: T.accent,               spin: true,  text: 'En cours…'     };
  if (status === 'success')
    return { icon: Check,          color: 'rgb(74 222 128)',       spin: false, text: 'Terminé'        };
  if (status === 'not_configured')
    return { icon: Info,           color: 'rgb(148 163 184)',      spin: false, text: 'Non connecté'   };
  if (status === 'not_found')
    return { icon: Info,           color: 'rgb(148 163 184)',      spin: false, text: 'Non disponible' };
  if (status === 'error')
    return { icon: AlertTriangle,  color: 'rgb(251 191 36)',       spin: false, text: 'Indisponible'   };
  // fallback
  return   { icon: Info,           color: 'rgb(148 163 184)',      spin: false, text: status           };
}

export function CopilotToolCallCard({ call }: { call: ActiveToolCall }) {
  const v = statusVisual(call.status);
  const Icon = v.icon;
  const label = TOOL_LABELS[call.name] ?? call.name;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 11px', margin: '4px 0', borderRadius: 10,
      background: 'rgb(255 255 255 / 0.03)', border: `1px solid ${T.borderSoft}`,
      fontSize: 12.5, color: T.textMuted,
    }}>
      <Wrench size={13} color={T.textMuted} style={{ opacity: 0.6 }} />
      <span style={{ color: T.text, fontWeight: 600 }}>{label}</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: v.color }}>
        <Icon size={13} style={v.spin ? { animation: 'copilot-spin 1s linear infinite' } : undefined} />
        {v.text}
        {call.durationMs
          ? <span style={{ opacity: 0.5, fontSize: 11 }}>· {(call.durationMs / 1000).toFixed(1)}s</span>
          : null}
      </span>
    </div>
  );
}