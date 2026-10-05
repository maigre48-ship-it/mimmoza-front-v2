import { useMemo, type CSSProperties } from 'react';
import { MapPin, Scale, TrendingUp, ShieldCheck, Leaf, Building2, Hammer, Landmark, BriefcaseBusiness, Wallet, ExternalLink, LoaderCircle, ChevronDown } from 'lucide-react';
import type { ActiveToolCall } from '../types/copilot.types';
import { buildApiResult, formatApiValue, type ApiFamily } from '../results/apiResultModel';
import { CopilotToolCallCard } from './CopilotToolCallCard';
import './CopilotApiResultCard.css';

const FAMILIES = {
  parcel: { label: 'Foncier', icon: MapPin, color: '#6353c8', soft: '#f3f0ff' },
  urbanism: { label: 'Urbanisme', icon: Scale, color: '#5f49b3', soft: '#f3efff' },
  market: { label: 'Marché', icon: TrendingUp, color: '#215cb8', soft: '#edf4ff' },
  risk: { label: 'Risques', icon: ShieldCheck, color: '#995414', soft: '#fff5e7' },
  energy: { label: 'Énergie', icon: Leaf, color: '#237251', soft: '#edf8f2' },
  building: { label: 'Bâtiment', icon: Building2, color: '#53627b', soft: '#f0f3f8' },
  cost: { label: 'Travaux', icon: Hammer, color: '#a24e25', soft: '#fff3ec' },
  context: { label: 'Territoire', icon: Landmark, color: '#16717c', soft: '#eaf7f8' },
  business: { label: 'Interlocuteurs', icon: BriefcaseBusiness, color: '#76518d', soft: '#f8f0fc' },
  finance: { label: 'Finances', icon: Wallet, color: '#365c9e', soft: '#eff4ff' },
} satisfies Record<ApiFamily, { label: string; icon: typeof MapPin; color: string; soft: string }>;
const STATUS = { running: 'Recherche en cours', ready: 'Résultats disponibles', partial: 'Données partielles', empty: 'Aucun résultat', error: 'Source indisponible' };
const ENERGY_COLORS: Record<string, string> = { A: '#187a45', B: '#4c8739', C: '#808724', D: '#b08012', E: '#b9621b', F: '#bf3f24', G: '#a42d34' };
const dateText = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR').format(date);
};

/** Une carte par appel métier, sans relancer l’API ni modifier ses chiffres. */
export function CopilotApiResultCard({ call }: { call: ActiveToolCall }) {
  const model = useMemo(() => buildApiResult(call), [call.name, call.status, call.output]);
  if (!model) return <CopilotToolCallCard call={call} />;
  const family = FAMILIES[model.family], Icon = family.icon;
  const hasResults = model.metrics.length + model.charts.length + model.tables.length > 0;
  return <section className={`copilot-api-card copilot-api-card--${model.state}`}
    style={{ '--api-accent': family.color, '--api-soft': family.soft } as CSSProperties}
    aria-label={model.title} aria-busy={model.state === 'running'}>
    <header className="copilot-api-header">
      <span className="copilot-api-icon"><Icon size={19} aria-hidden="true" /></span>
      <div className="copilot-api-heading"><span className="copilot-api-family">{family.label}</span><h3>{model.title}</h3></div>
      <span className="copilot-api-status">{model.state === 'running' && <LoaderCircle size={13} className="copilot-api-spinner" aria-hidden="true" />}{STATUS[model.state]}</span>
    </header>
    {model.scope && <p className="copilot-api-scope"><MapPin size={12} aria-hidden="true" />{model.scope}</p>}
    {model.summary && <p className="copilot-api-summary">{model.summary}</p>}
    {model.state === 'running' && <p className="copilot-api-wait" role="status">Les résultats apparaîtront à la fin de la recherche.</p>}
    {model.metrics.length > 0 && <dl className="copilot-api-metrics">{model.metrics.map((metric, i) => <div key={i} className={metric.value === 'Non renseigné' ? 'copilot-api-missing' : ''}>
      <dt>{metric.label}</dt><dd>{metric.unit ? <><span>{metric.value.slice(0, -metric.unit.length).trim()}</span><span className="copilot-api-metric-unit">{metric.unit}</span></> : dateText(metric.value)}</dd>{metric.note && <small>{metric.note}</small>}
    </div>)}</dl>}
    {model.range && <figure className="copilot-api-chart">
      <figcaption>{model.range.title}</figcaption>
      <div className="copilot-api-range" aria-hidden="true"><span style={{ left: `${100 * (model.range.mid - model.range.low) / (model.range.high - model.range.low)}%` }} /></div>
      <div className="copilot-api-range-labels"><span>Q1<strong>{formatApiValue(model.range.low, model.range.unit)}</strong></span><span>Médiane<strong>{formatApiValue(model.range.mid, model.range.unit)}</strong></span><span>Q3<strong>{formatApiValue(model.range.high, model.range.unit)}</strong></span></div>
    </figure>}
    {model.charts.map((chart, i) => {
      const max = chart.max ?? Math.max(1, ...chart.items.map((item) => item.value));
      return <figure key={i} className="copilot-api-chart"><figcaption>{chart.title}</figcaption>
        <ul className="copilot-api-bars">{chart.items.map((item, j) => <li key={j}>
          <div className="copilot-api-bar-label"><span>{item.label}</span><strong>{formatApiValue(item.value, chart.unit)}</strong></div>
          <div className="copilot-api-bar-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, item.value / max * 100))}%`, background: item.tone ? ENERGY_COLORS[item.tone] : undefined }} /></div>
        </li>)}</ul>
      </figure>;
    })}
    {model.tables.map((table, i) => <details key={i} className="copilot-api-details" open={model.tables.length === 1 && !model.charts.length && model.metrics.length <= 2}>
      <summary><span>{table.title}{table.total != null && <small>{table.total} élément{table.total !== 1 ? 's' : ''} retourné{table.total !== 1 ? 's' : ''}</small>}</span><ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="copilot-api-table-wrap" tabIndex={0} role="region" aria-label={table.title}>
        <table><caption className="copilot-api-sr-only">{table.title}</caption><thead><tr>{table.columns.map((col, c) => <th key={c} scope="col">{col}</th>)}</tr></thead><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className={cell === 'Non renseigné' ? 'copilot-api-cell-missing' : ''}>{c === 0 && table.links?.[r] ? <a href={table.links[r]!} target="_blank" rel="noopener noreferrer">{cell} <ExternalLink size={10} aria-hidden="true" /></a> : cell}</td>)}</tr>)}</tbody></table>
      </div>
      {table.total != null && table.rows.length < table.total && <p className="copilot-api-table-note">{table.rows.length} sur {table.total} éléments retournés affichés.</p>}
    </details>)}
    {!hasResults && !model.summary && model.state !== 'running' && <p className="copilot-api-wait">Aucune donnée structurée exploitable dans ce résultat.</p>}
    {model.notes.length > 0 && <aside className="copilot-api-notes" aria-label="Périmètre et limites">
      <strong>À garder en tête</strong>
      {model.notes.slice(0, 2).map((note, i) => <p key={i}>{note}</p>)}
      {model.notes.length > 2 && <details><summary>{model.notes.length - 2} précision{model.notes.length > 3 ? 's' : ''} supplémentaire{model.notes.length > 3 ? 's' : ''}</summary>{model.notes.slice(2).map((note, i) => <p key={i}>{note}</p>)}</details>}
    </aside>}
    <footer className="copilot-api-footer">
      <span>Source : {model.source ?? 'Non précisée dans le résultat'}</span>
      {model.date && <span>{model.dateLabel} : {dateText(model.date)}</span>}
      {model.url && <a href={model.url} target="_blank" rel="noopener noreferrer">Consulter la source <ExternalLink size={12} aria-hidden="true" /></a>}
    </footer>
  </section>;
}
