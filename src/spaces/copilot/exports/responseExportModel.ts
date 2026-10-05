import type { ChatMessage } from '../types/copilot.types';
import { buildApiResult, record, number, safeSourceUrl } from '../results/apiResultModel';
import { decouperSegments } from '../charts/copilotChart.types';

export type ExportCell = string | number | boolean | null;
export type ReportTable = { title: string; columns: string[]; rows: ExportCell[][] };
export type ReportChart = { title: string; unit: string; type: 'bar' | 'line' | 'pie' | 'donut'; series: string[]; rows: { label: string; values: (number | null)[] }[]; source?: string };
export type ReportBlock = { kind: 'heading'; text: string } | { kind: 'paragraph'; text: string } | { kind: 'table'; table: ReportTable } | { kind: 'chart'; chart: ReportChart };
export type ReportSection = { title: string; status: string; source: string; scope: string; date: string; url: string | null; summary: string; tables: ReportTable[]; charts: ReportChart[]; notes: string[] };
export type ResponseReport = { title: string; question: string; responseDate: string; exportDate: string; narrative: ReportBlock[]; sections: ReportSection[]; notice: string };
const str = (v: unknown) => typeof v === 'string' ? v : '';
export const plainText = (value: string) => value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/\\\|/g, '|');
export const cellText = (value: ExportCell) => value === null ? 'Non renseigné' : typeof value === 'number' ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) : typeof value === 'boolean' ? value ? 'Oui' : 'Non' : value;
const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((v) => plainText(v.trim()));
const tableSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

export function parseReportText(text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const segment of decouperSegments(text)) {
    if (segment.kind === 'chart') {
      const c = segment.spec, series = c.series ?? ['value'];
      blocks.push({ kind: 'chart', chart: { title: c.title ?? 'Graphique de la réponse', unit: c.unit ?? '', type: c.type, series: series.map(s => s === 'value' ? 'Valeur' : s), source: c.source,
        rows: c.data.map(p => ({ label: p.label, values: series.map(s => number(p[s])) })) } });
      continue;
    }
    const lines = segment.text.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^-{3,}$/.test(line)) continue;
      if (i + 1 < lines.length && line.includes('|') && tableSeparator(lines[i + 1])) {
        const columns = tableCells(line), rows: ExportCell[][] = []; i += 2;
        while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) { rows.push(tableCells(lines[i])); i++; }
        i--; blocks.push({kind:'table',table:{title:'Tableau de la réponse',columns,rows}}); continue;
      }
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      blocks.push({kind:heading ? 'heading' : 'paragraph',text:plainText(heading ? heading[1] : line.replace(/^>\s*/, '').replace(/^[-*]\s+/, '• '))});
    }
  }
  return blocks;
}
export function chartTable(chart: ReportChart): ReportTable {
  return { title: chart.title, columns: ['Libellé', ...chart.series.map(s => `${s}${chart.unit ? ` (${chart.unit})` : ''}`)], rows: chart.rows.map(r => [r.label,...r.values]) };
}
const STATES = { running: 'Recherche en cours', ready: 'Résultats disponibles', partial: 'Données partielles', empty: 'Aucun résultat', error: 'Source indisponible' };

export function buildResponseReport(params: { response: ChatMessage; question?: string | null }, exportedAt = new Date().toISOString()): ResponseReport {
  const report: ResponseReport = { title: 'Analyse immobilière Mimmoza', question: params.question ?? '', responseDate: params.response.createdAt, exportDate: exportedAt,
    narrative: parseReportText(params.response.text), sections: [], notice: 'Cet export reprend la réponse et les résultats disponibles à sa date. Les données ne se mettent pas à jour automatiquement. Les valeurs absentes restent non renseignées. Les chiffres fournis par les API sont distingués du texte de l’IA.' };
  for (const call of params.response.toolCalls) {
    const model = buildApiResult(call, { tableLimit: Number.MAX_SAFE_INTEGER });
    if (!model) continue;
    const tables: ReportTable[] = [];
    if (model.metrics.length) tables.push({ title: 'Indicateurs', columns: ['Indicateur','Valeur','Unité','Précision'], rows: model.metrics.map(m => [m.label,m.numericValue ?? (m.value === 'Non renseigné' ? null : m.value),m.unit ?? '',m.note ?? '']) });
    for (const table of model.tables) {
      const hasLinks = table.links?.some(Boolean);
      tables.push({title:table.title,columns:[...table.columns.map((col,i)=>`${col}${table.units?.[i] ? ` (${table.units[i]})` : ''}`),...(hasLinks ? ['Lien'] : [])],
        rows:(table.values ?? table.rows).map((row,i)=>[...row,...(hasLinks ? [table.links?.[i] ?? ''] : [])])});
    }
    if (model.range) tables.push({title:model.range.title,columns:['Repère',`Prix (${model.range.unit})`],rows:[['Q1',model.range.low],['Médiane',model.range.mid],['Q3',model.range.high]]});
    report.sections.push({title:model.title,status:STATES[model.state],source:model.source ?? 'Source non précisée',scope:model.scope ?? 'Périmètre non précisé',date:model.date ? `${model.dateLabel} : ${model.date}` : 'Date de la source non précisée',url:model.url,summary:model.summary ?? '',tables,
      charts:model.charts.map(c=>({title:c.title,unit:c.unit,type:'bar',series:['Valeur'],rows:c.items.map(i=>({label:i.label,values:[i.value]})),source:model.source ?? undefined})),notes:model.notes});
  }
  for (const call of params.response.toolCalls.filter(c=>c.name==='calculer_bilan_financier')) {
    const out = record(call.output), d = record(out.data);
    const section: ReportSection = {title:str(d.titre)||'Bilan financier',status:out.status==='ok'?'Résultats calculés':out.status==='partial'?'Bilan à compléter':'Calcul indisponible',source:str(out.source)||'Moteur Bilan Mimmoza',scope:`Montants ${str(d.base_montants)||'non précisés'}`,date:`Date du résultat : ${report.responseDate}`,url:null,summary:'',tables:[],charts:[],notes:[]};
    if (out.status === 'ok' && d.kind === 'chat_bilan_vente_v1') {
      const indicators: [string,string,string][] = [['Recettes','recettes_eur','€'],['Coût total','cout_total_eur','€'],['Résultat avant fiscalité','resultat_eur','€'],['Marge sur recettes','marge_sur_ca_pct','%'],['Recettes à l’équilibre','seuil_equilibre_recettes_eur','€'],['Prix à l’équilibre','prix_equilibre_m2_eur','€/m² vendable'],['Résultat / fonds propres non annualisé','resultat_sur_fonds_propres_pct','%'],['Marge cible','marge_cible_pct','%']];
      section.tables.push({title:'Résultats',columns:['Indicateur','Valeur','Unité'],rows:indicators.filter(([,key])=>key in d).map(([label,key,unit])=>[label,number(d[key]),unit])});
      if (Array.isArray(d.postes)) section.tables.push({title:'Dépenses par poste',columns:['Poste',`Montant (€ ${str(d.base_montants)})`],rows:d.postes.map(p=>[str(record(p).label),number(record(p).montant_eur)])});
      if (Array.isArray(d.scenarios)) {
        section.tables.push({title:'Sensibilités',columns:['Scénario','Recettes (€)','Coûts (€)','Résultat (€)','Marge sur recettes (%)'],rows:d.scenarios.map(s=>{const r=record(s);return [str(r.label),number(r.recettes_eur),number(r.cout_total_eur),number(r.resultat_eur),number(r.marge_sur_ca_pct)];})});
        section.charts.push({title:'Résultat par scénario',unit:'€',type:'bar',series:['Résultat avant fiscalité'],rows:d.scenarios.map(s=>({label:str(record(s).label),values:[number(record(s).resultat_eur)]})),source:section.source});
      }
      const levers = record(d.leviers_marge_cible);
      if (Object.keys(levers).length) {
        section.tables.push({title:'Leviers de marge cible',columns:['Levier','Valeur','Unité'],rows:[['Économies à recettes constantes',number(levers.economies_necessaires_a_recettes_constantes_eur),'€'],['Recettes cibles à coûts constants',number(levers.recettes_cibles_a_couts_constants_eur),'€'],['Prix cible à surface et coûts constants',number(levers.prix_vente_cible_a_surface_et_couts_constants_m2_eur),'€/m²'],['Surface cible à prix et coûts constants',number(levers.surface_cible_a_prix_et_couts_constants_m2),'m²']]});
        if (str(levers.reserve)) section.notes.push(str(levers.reserve));
      }
      for (const list of [d.hypotheses,d.reserves]) if(Array.isArray(list)) section.notes.push(...list.filter((n):n is string=>typeof n==='string'));
    } else if(Array.isArray(d.missing)) section.notes.push(...d.missing.filter((n):n is string=>typeof n==='string').map(n=>`À préciser : ${n}`));
    report.sections.push(section);
  }
  const webCalls = params.response.toolCalls.filter(c=>c.name==='web_search'||c.name==='web_fetch');
  if (webCalls.length) {
    const sources = new Map<string,string>();
    for(const c of webCalls) if(c.status==='success'&&Array.isArray(record(c.output).sources)) for(const item of record(c.output).sources as unknown[]) {
      const s=record(item),url=safeSourceUrl(s.url); if(url)sources.set(url,str(s.title)||url);
    }
    report.sections.push({title:'Recherche sur Internet',status:sources.size?'Sources trouvées':'Aucune source exploitable',source:'Recherche web Anthropic',scope:'Pages consultées pour cette réponse',date:`Date du résultat : ${report.responseDate}`,url:null,summary:'',
      tables:sources.size?[{title:'Sources web',columns:['Titre','URL'],rows:[...sources].map(([url,title])=>[title,url])}]:[],charts:[],notes:webCalls.some(c=>c.status==='error')?['Vérification partielle : certaines consultations n’ont pas abouti. Une source trouvée ne confirme pas la lecture de tout son contenu.']:[]});
  }
  return report;
}

/** Découpe déterministe, sans couper de mots ni supprimer la fin du texte. */
export function splitReportText(text: string, maxLength = 650): string[] {
  const parts: string[] = []; let remaining = text.trim();
  while (remaining.length > maxLength) {
    let at = remaining.lastIndexOf(' ', maxLength); if(at < maxLength / 2) at=maxLength;
    parts.push(remaining.slice(0,at)); remaining=remaining.slice(at).trimStart();
  }
  if(remaining)parts.push(remaining); return parts;
}

/** Budget de lignes pour les slides : les sauts de paragraphe comptent aussi. */
export function paginateSlideText(text: string): string[] {
  const lines=text.trim().split('\n').flatMap(line=>line.trim()?splitReportText(line.trim(),78):['']);
  const pages:string[]=[];
  for(let i=0;i<lines.length;i+=10){const page=lines.slice(i,i+10).join('\n').trim();if(page)pages.push(page);}
  return pages;
}
