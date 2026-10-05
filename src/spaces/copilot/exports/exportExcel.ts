import ExcelJS from 'exceljs';
import { cellText, chartTable, splitReportText, type ResponseReport, type ReportTable, type ExportCell } from './responseExportModel';
import { safeSourceUrl } from '../results/apiResultModel';
import type { ChartImage } from './reportCharts';

export function buildExcelReport(report: ResponseReport, images: ChartImage[] = []): ExcelJS.Workbook {
  const workbook=new ExcelJS.Workbook();workbook.creator='Mimmoza';workbook.created=new Date(report.exportDate);
  const names=new Set<string>();
  const sheet = (title:string,count=4) => {
    const base=title.replace(/[\\/*?:\[\]]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,31)||'Résultats';
    let name=base,i=2;while(names.has(name.toLowerCase()))name=`${base.slice(0,26)} ${i++}`;names.add(name.toLowerCase());
    const ws=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:2,showGridLines:false}],pageSetup:{paperSize:9,orientation:count>4?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
    ws.columns=Array.from({length:count},(_,c)=>({width:c===0?38:24}));
    ws.properties.defaultRowHeight=20;ws.headerFooter.oddFooter='Mimmoza | &P / &N';return ws;
  };
  const writeCell = (cell:ExcelJS.Cell,value:ExportCell) => {
    const url=safeSourceUrl(value);
    cell.value=url?{text:String(value),hyperlink:url}:value;
    cell.font={name:'Aptos',size:11,color:{argb:url?'FF4F46E5':'FF172238'},...(url?{underline:true}:{})};
    cell.alignment={vertical:'top',wrapText:true};
    if(typeof value==='number')cell.numFmt=Number.isInteger(value)?'#,##0':'#,##0.00';
  };
  const line = (ws:ExcelJS.Worksheet,text:string,heading=false) => {
    for(const part of splitReportText(text,900)){
      const row=ws.addRow([part]);ws.mergeCells(row.number,1,row.number,ws.columnCount);
      row.height=Math.max(22,Math.ceil(part.length/(ws.columnCount*26))*16+8);
      const cell=row.getCell(1);writeCell(cell,part);if(heading){cell.font={name:'Aptos',size:14,bold:true,color:{argb:'FF233451'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF3FA'}};}
    }
  };
  const table = (ws:ExcelJS.Worksheet,t:ReportTable) => {
    line(ws,t.title,true);
    const head=ws.addRow(t.columns);head.height=34;head.eachCell(c=>{c.font={name:'Aptos',size:11,bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF233451'}};c.alignment={wrapText:true,vertical:'middle'};});
    for(const values of t.rows){const row=ws.addRow(values.map(v=>v??null));
      values.forEach((v,c)=>{const cell=row.getCell(c+1);writeCell(cell,v);cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:row.number%2?'FFFFFFFF':'FFF5F7FA'}};cell.border={bottom:{style:'hair',color:{argb:'FFD9D9D9'}}};});
      row.height=Math.min(409,Math.max(22,Math.ceil(Math.max(...values.map((v,c)=>cellText(v).length/(c===0?36:22)))*15)+6));
    }ws.addRow([]);
  };
  const addImages = (ws:ExcelJS.Worksheet,id:string) => { for(const image of images.filter(i=>i.id===id)){
    const imageId=workbook.addImage({base64:image.data,extension:'png'}),width=Math.min(800,ws.columnCount*140),height=Math.round(width*image.height/image.width);
    ws.addImage(imageId,{tl:{col:0,row:ws.rowCount},ext:{width,height}});for(let r=0;r<Math.ceil(height/26)+1;r++)ws.addRow(['']);
  }};
  const maxNarrative=Math.max(4,...report.narrative.map(b=>b.kind==='table'?b.table.columns.length:b.kind==='chart'?b.chart.series.length+1:4));
  const summary=sheet('Synthèse',maxNarrative);
  line(summary,report.title,true);line(summary,`Réponse : ${report.responseDate} — Export : ${report.exportDate}`);line(summary,report.notice);line(summary,'Les cellules numériques sont modifiables. Les cellules vides signalent une donnée non renseignée ; ce classeur conserve les résultats exportés, sans recalculer les hypothèses.');
  if(report.question){line(summary,'Question de départ',true);line(summary,report.question);}
  line(summary,'Réponse de Mimmoza',true);
  report.narrative.forEach((b,i)=>{if(b.kind==='paragraph'||b.kind==='heading')line(summary,b.text,b.kind==='heading');else if(b.kind==='table')table(summary,b.table);else{table(summary,chartTable(b.chart));if(b.chart.source)line(summary,`Source : ${b.chart.source}`);addImages(summary,`n-${i}`);}});
  for(const [s,section]of report.sections.entries()){
    const ws=sheet(section.title,Math.max(4,...section.tables.map(t=>t.columns.length),...section.charts.map(c=>c.series.length+1)));
    line(ws,section.title,true);line(ws,section.status);line(ws,`Source : ${section.source}`);line(ws,`Périmètre : ${section.scope}`);line(ws,section.date);if(section.url)line(ws,section.url);if(section.summary)line(ws,section.summary);
    section.tables.forEach(t=>table(ws,t));section.charts.forEach((c,i)=>{table(ws,chartTable(c));addImages(ws,`s-${s}-${i}`);});
    if(section.notes.length){line(ws,'Périmètre et réserves',true);section.notes.forEach(n=>line(ws,n));}
  }
  return workbook;
}
export async function excelBlob(report:ResponseReport,images:ChartImage[]):Promise<Blob>{const buffer=await buildExcelReport(report,images).xlsx.writeBuffer();return new Blob([new Uint8Array(buffer).buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
