import type { ActiveToolCall } from '../types/copilot.types';
import { COPILOT_THEME as T } from './copilotTheme';
import { CopilotToolCallCard } from './CopilotToolCallCard';

type Bilan = {
  kind: string; titre: string; base_montants: string;
  postes: { label: string; montant_eur: number }[];
  recettes_eur: number; cout_total_eur: number; resultat_eur: number; marge_sur_ca_pct: number;
  seuil_equilibre_recettes_eur: number; prix_equilibre_m2_eur?: number;
  resultat_sur_fonds_propres_pct?: number; marge_cible_pct?: number; ecart_cible_points?: number;
  leviers_marge_cible?: {
    cible_atteinte: boolean;
    economies_necessaires_a_recettes_constantes_eur: number;
    recettes_cibles_a_couts_constants_eur: number;
    prix_vente_cible_a_surface_et_couts_constants_m2_eur?: number;
    surface_cible_a_prix_et_couts_constants_m2?: number;
    reserve: string;
  };
  scenarios: { label: string; recettes_eur: number; cout_total_eur: number; resultat_eur: number; marge_sur_ca_pct: number }[];
  hypotheses: string[]; reserves: string[];
};
const euros = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
const percent = (v: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v)} %`;

export function CopilotFinancialCard({ call, onSend }: { call: ActiveToolCall; onSend?: (text: string) => void }) {
  const output = call.output as { status?: string; data?: Bilan & { missing?: string[]; invalid?: string[] } } | undefined;
  const data = output?.data;
  if (output?.status === 'partial' && data?.missing) return <div style={{ padding: 12, border: `1px solid ${T.borderSoft}`, borderRadius: 12, color: T.text, margin: '8px 0' }}>
    <strong>Bilan à compléter</strong>
    <p style={{ margin: '6px 0', fontSize: 13 }}>Il reste à préciser :</p>
    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>{data.missing.map((label) => <li key={label}>{label}</li>)}</ul>
  </div>;
  if (output?.status !== 'ok' || data?.kind !== 'chat_bilan_vente_v1') return <CopilotToolCallCard call={call} />;
  const rows = [
    ['Recettes de vente', euros(data.recettes_eur)], ['Coût total', euros(data.cout_total_eur)],
    ['Résultat avant fiscalité', euros(data.resultat_eur)], ['Marge sur recettes', percent(data.marge_sur_ca_pct)],
    ['Recettes au seuil d’équilibre', euros(data.seuil_equilibre_recettes_eur)],
    ...(data.prix_equilibre_m2_eur !== undefined ? [['Prix au seuil d’équilibre', `${euros(data.prix_equilibre_m2_eur)}/m² vendable`]] : []),
    ...(data.resultat_sur_fonds_propres_pct !== undefined ? [['Résultat / fonds propres (non annualisé)', percent(data.resultat_sur_fonds_propres_pct)]] : []),
    ...(data.marge_cible_pct !== undefined ? [['Marge cible sur recettes', percent(data.marge_cible_pct)]] : []),
  ];
  const cell = { padding: '7px 6px', borderBottom: `1px solid ${T.borderSoft}`, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
  return <section aria-label="Bilan financier calculé" style={{ padding: 14, border: `1px solid ${T.borderSoft}`, borderRadius: 12, color: T.text, margin: '8px 0', fontSize: 13 }}>
    <strong style={{ fontSize: 15 }}>{data.titre}</strong>
    <p style={{ color: T.textMuted, margin: '5px 0 10px' }}>Bilan de vente · montants {data.base_montants} · moteur Mimmoza</p>
    <dl style={{ margin: 0 }}>{rows.map(([label, value]) => <div key={label} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: '5px 0' }}>
      <dt>{label}</dt><dd style={{ margin: 0, fontWeight: 600, color: label === 'Résultat avant fiscalité' ? (data.resultat_eur >= 0 ? 'rgb(74 222 128)' : 'rgb(251 191 36)') : T.text }}>{value}</dd>
    </div>)}</dl>
    <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer' }}>Dépenses par poste</summary>
      <dl>{data.postes.map((poste) => <div key={poste.label} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
        <dt>{poste.label}</dt><dd style={{ margin: 0 }}>{euros(poste.montant_eur)}</dd>
      </div>)}</dl>
    </details>
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <caption style={{ textAlign: 'left', fontWeight: 600, marginBottom: 6 }}>Sensibilité aux ventes et aux travaux</caption>
        <thead><tr><th style={{ ...cell, textAlign: 'left' }}>Scénario</th><th style={cell}>Résultat</th><th style={cell}>Marge / recettes</th></tr></thead>
        <tbody>{data.scenarios.map((scenario) => <tr key={scenario.label}><td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>{scenario.label}</td>
          <td style={cell}>{euros(scenario.resultat_eur)}</td><td style={cell}>{percent(scenario.marge_sur_ca_pct)}</td></tr>)}</tbody>
      </table>
    </div>
    {data.leviers_marge_cible && <div style={{ marginTop: 12 }}>
      <strong>{data.leviers_marge_cible.cible_atteinte ? 'Marge cible atteinte' : 'Leviers pour atteindre la marge cible'}</strong>
      {!data.leviers_marge_cible.cible_atteinte && <ul style={{ paddingLeft: 20 }}>
        <li>À recettes constantes : économiser {euros(data.leviers_marge_cible.economies_necessaires_a_recettes_constantes_eur)}.</li>
        <li>À coûts constants : atteindre {euros(data.leviers_marge_cible.recettes_cibles_a_couts_constants_eur)} de recettes
          {data.leviers_marge_cible.prix_vente_cible_a_surface_et_couts_constants_m2_eur !== undefined
            ? `, soit ${euros(data.leviers_marge_cible.prix_vente_cible_a_surface_et_couts_constants_m2_eur)}/m² à surface constante.` : '.'}</li>
      </ul>}
      <details style={{ marginTop: 7 }}><summary style={{ cursor: 'pointer' }}>Conditions et seuil de surface théorique</summary>
        {data.leviers_marge_cible.surface_cible_a_prix_et_couts_constants_m2 !== undefined && <p>Surface vendable théorique à prix et coûts constants : {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(data.leviers_marge_cible.surface_cible_a_prix_et_couts_constants_m2)} m².</p>}
        <p style={{ color: T.textMuted }}>{data.leviers_marge_cible.reserve}</p>
      </details>
    </div>}
    <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer' }}>Hypothèses et périmètre du calcul</summary>
      <ul style={{ paddingLeft: 20, color: T.textMuted }}>{[...data.hypotheses, ...data.reserves].map((text, index) => <li key={index}>{text}</li>)}</ul>
    </details>
    {data.base_montants === 'TTC' && <p style={{ color: T.textMuted }}>Solde TTC avant traitement de la TVA : ne constitue pas une marge économique HT.</p>}
    {onSend && <button type="button" onClick={() => onSend(`Je souhaite modifier une hypothèse du bilan « ${data.titre} ». Demande-moi laquelle, puis recalcule avec le moteur en conservant les autres chiffres de ce bilan.`)}
      style={{ marginTop: 12, border: `1px solid ${T.borderSoft}`, borderRadius: 8, padding: '8px 12px', background: 'transparent', color: T.text, cursor: 'pointer' }}>Modifier les hypothèses</button>}
  </section>;
}
