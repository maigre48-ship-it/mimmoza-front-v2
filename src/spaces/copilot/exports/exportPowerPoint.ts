import pptxgen from 'pptxgenjs';
import { paginateSlideText, cellText, chartTable, type ResponseReport, type ReportChart, type ReportTable } from './responseExportModel';
import { safeSourceUrl } from '../results/apiResultModel';

export function buildPowerPointReport(report:ResponseReport):pptxgen{
  const deck=new pptxgen();deck.layout='LAYOUT_WIDE';deck.author='Mimmoza';deck.subject='Analyse immobilière';deck.title=report.title;deck.company='Mimmoza';deck.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos'};
  let page=0;
  const slide=(title:string,source='Mimmoza',scope='',notes='')=>{
    const s=deck.addSlide();s.background={color:'FFFFFF'};page++;
    s.addText(title,{x:.65,y:.42,w:12,h:.72,fontFace:'Aptos Display',fontSize:30,bold:true,color:'172238',breakLine:false,fit:'resize'});
    s.addText('MIMMOZA',{x:.65,y:6.94,w:2,h:.2,fontSize:10,bold:true,color:'5B55BA'});
    s.addText(String(page),{x:12,y:6.94,w:.65,h:.2,fontSize:10,align:'right',color:'64748B'});
    const footer=`Source : ${source}${scope?` — ${scope}`:''}`;
    s.addText(footer,{x:.65,y:6.48,w:12,h:.38,fontSize:10,color:'59647A',fit:'resize'});
    s.addNotes(`${notes}\n${footer}`);return s;
  };
  const textSlides=(title:string,text:string,source?:string,scope?:string)=>{
    paginateSlideText(text).forEach((part,i)=>{const s=slide(`${title}${i?` (${i+1})`:''}`,source,scope,text);s.addText(part,{x:.7,y:1.55,w:11.95,h:4.45,fontSize:22,color:'26354C',valign:'top',breakLine:false,paraSpaceAfter:0});});
  };
  const tableSlides=(title:string,table:ReportTable,source?:string,scope?:string)=>{
    // Les longues cellules passent en fiches textuelles, pour conserver le texte.
    const wide=table.columns.length>6||table.rows.some(r=>r.some(c=>cellText(c).length>210));
    if(wide){table.rows.forEach((row,i)=>textSlides(`${title} (${i+1})`,table.columns.map((c,j)=>`${c} : ${cellText(row[j]??null)}`).join('\n\n'),source,scope));return;}
    let rows:typeof table.rows=[];let height=0;
    const flush=()=>{if(!rows.length)return;
      const s=slide(title,source,scope,table.rows.map(r=>r.map(cellText).join(' ; ')).join('\n'));
      const data=[table.columns.map(text=>({text,options:{bold:true,color:'FFFFFF',fill:{color:'233451'}}})),...rows.map(r=>table.columns.map((_,i)=>({text:cellText(r[i]??null),options:safeSourceUrl(r[i])?{hyperlink:{url:safeSourceUrl(r[i])!},color:'4F46E5'}:{}})))];
      s.addTable(data,{x:.65,y:1.35,w:12.02,fontFace:'Aptos',fontSize:17,color:'172238',border:{type:'solid',color:'D9D9D9',pt:.5},margin:8,colW:table.columns.map((_,i)=>i===0?3.3:8.72/Math.max(1,table.columns.length-1)),rowH:.45,fill:{color:'F7F9FC'},valign:'middle',autoPage:false});rows=[];height=0;
    };
    for(const row of table.rows){const lines=Math.max(...row.map((v,i)=>Math.ceil(cellText(v).length/(i===0?28:Math.max(9,Math.floor(80/Math.max(1,table.columns.length-1)))))));
      const rowHeight=Math.max(.5,lines*.26+.2);
      if(rows.length&&(height+rowHeight>4.1||rows.length>=6))flush();rows.push(row);height+=rowHeight;
      if(rowHeight>4.1){rows=[];height=0;textSlides(title,table.columns.map((c,i)=>`${c} : ${cellText(row[i]??null)}`).join('\n\n'),source,scope);}
    }flush();
  };
  const chartSlides=(chart:ReportChart,source?:string,scope?:string)=>{
    // Une série incomplète reste un tableau : jamais de trou remplacé par zéro.
    if(chart.rows.some(r=>r.values.some(v=>v===null))){tableSlides(chart.title,chartTable(chart),source,scope);return;}
    for(let i=0;i<chart.rows.length;i+=12){const rows=chart.rows.slice(i,i+12),s=slide(`${chart.title}${i?' (suite)':''}`,source??chart.source,scope,JSON.stringify(chart));
      const energyColors:Record<string,string>={A:'187A45',B:'4C8739',C:'808724',D:'B08012',E:'B9621B',F:'BF3F24',G:'A42D34'};
      s.addChart(chart.type==='line'?deck.ChartType.line:chart.type==='pie'?deck.ChartType.pie:chart.type==='donut'?deck.ChartType.doughnut:deck.ChartType.bar,
        chart.series.map((name,j)=>({name,labels:rows.map(r=>r.label),values:rows.map(r=>r.values[j]!)})),
        {x:.7,y:1.45,w:11.9,h:4.75,catAxisLabelFontSize:13,valAxisLabelFontSize:12,showLegend:chart.series.length>1,legendPos:'b',legendFontSize:14,dataLabelFormatCode:'#,##0.##',dataLabelPosition:'outEnd',dataLabelColor:'172238',chartColors:rows.every(r=>energyColors[r.label])?rows.map(r=>energyColors[r.label]):['5B55BA','237B87','B07723'],barDir:'bar',valAxisTitle:chart.unit,showValAxisTitle:!!chart.unit,showValue:false,showTitle:false});
    }
  };
  const cover=slide(report.title,'Mimmoza','',report.notice);
  cover.addText('Réponse et résultats des API',{x:.7,y:1.85,w:11.8,h:.7,fontSize:30,color:'5B55BA'});
  cover.addText(`Réponse du ${new Date(report.responseDate).toLocaleString('fr-FR')}\nExport du ${new Date(report.exportDate).toLocaleString('fr-FR')}`,{x:.7,y:3,w:11.8,h:1,fontSize:20,color:'59647A'});
  if(report.question)textSlides('Question de départ',report.question);
  textSlides('Périmètre de l’export',report.notice);
  let narrativeTitle='Réponse de Mimmoza',paragraphs:string[]=[];
  const flushNarrative=()=>{if(paragraphs.length)textSlides(narrativeTitle,paragraphs.join('\n\n'));paragraphs=[];};
  for(const block of report.narrative){if(block.kind==='heading'){flushNarrative();narrativeTitle=block.text;}else if(block.kind==='paragraph')paragraphs.push(block.text);else{flushNarrative();if(block.kind==='table')tableSlides(narrativeTitle,block.table);else chartSlides(block.chart,block.chart.source);}}flushNarrative();
  for(const section of report.sections){
    textSlides(section.title,[section.status,section.date,section.summary,...section.notes].filter(Boolean).join('\n\n'),section.source,section.scope);
    for(const table of section.tables)tableSlides(`${section.title} — ${table.title}`,table,section.source,section.scope);
    section.charts.forEach(chart=>chartSlides(chart,section.source,section.scope));
  }
  return deck;
}
export async function powerPointBlob(report:ResponseReport):Promise<Blob>{const data=await buildPowerPointReport(report).write({outputType:'arraybuffer'});return new Blob([data as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});}
