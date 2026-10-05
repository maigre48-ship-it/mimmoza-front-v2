import { Document, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, TableLayoutType, BorderStyle, AlignmentType, ExternalHyperlink, ImageRun, Footer, PageNumber, Packer } from 'docx';
import { cellText, chartTable, type ResponseReport, type ReportTable, type ReportBlock } from './responseExportModel';
import { safeSourceUrl } from '../results/apiResultModel';
import type { ChartImage } from './reportCharts';

const WIDTH = 9360;
const heading = (text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 = HeadingLevel.HEADING_2) => new Paragraph({ text, heading: level, keepNext: true, spacing:{before:160,after:100} });
const paragraph = (text: string, small = false) => new Paragraph({ children:[new TextRun({text,size:small?19:22})],spacing:{after:120,line:small?260:300},...(text.startsWith('• ')?{bullet:{level:0},children:[new TextRun(text.slice(2))]}:{}) });
const linkParagraph = (url: string) => new Paragraph({ children: [new ExternalHyperlink({link:url,children:[new TextRun({text:url,style:'Hyperlink'})]})],spacing:{after:120} });

function wordTable(table: ReportTable): Table {
  const weights=table.columns.map((col,i)=>Math.max(10,Math.min(45,Math.max(col.length,...table.rows.map(row=>cellText(row[i]??null).length)))));
  const widths=weights.map(w=>Math.round(WIDTH*w/weights.reduce((a,b)=>a+b,0)));
  const border={style:BorderStyle.SINGLE,size:4,color:'D9D9D9'};
  const rows=[table.columns,...table.rows.map(row=>table.columns.map((_,i)=>cellText(row[i]??null)))];
  return new Table({width:{size:WIDTH,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},
    rows:rows.map((row,r)=>new TableRow({tableHeader:r===0,children:row.map((text,c)=>new TableCell({width:{size:widths[c],type:WidthType.DXA},margins:{top:70,bottom:70,left:120,right:120},shading:{fill:r===0?'233451':r%2?'FFFFFF':'F5F7FA'},
      children:[new Paragraph({alignment:/^[\d\s.,%€+−-]+$/.test(text)?AlignmentType.RIGHT:AlignmentType.LEFT,keepNext:rows.length<=6&&r<rows.length-1,spacing:{after:0,line:260},children:[safeSourceUrl(text)?new ExternalHyperlink({link:safeSourceUrl(text)!,children:[new TextRun({text,size:19,style:'Hyperlink'})]}):new TextRun({text,bold:r===0,color:r===0?'FFFFFF':'172238',size:19})]})]}))}))});
}

export function buildWordReport(report: ResponseReport, images: ChartImage[] = []): Document {
  const children: (Paragraph|Table)[] = [new Paragraph({text:report.title,heading:HeadingLevel.TITLE,spacing:{after:160}}),paragraph(`Réponse du ${displayDate(report.responseDate)} — export du ${displayDate(report.exportDate)}`,true),paragraph(report.notice,true)];
  if(report.question)children.push(heading('Question de départ'),paragraph(report.question));
  const appendChart = (id: string, chart: Extract<ReportBlock,{kind:'chart'}>['chart']) => {
    children.push(heading(chart.title));
    for(const image of images.filter(i=>i.id===id))children.push(new Paragraph({children:[new ImageRun({type:'png',data:image.data,transformation:{width:600,height:Math.round(600*image.height/image.width)}})],spacing:{after:160}}));
    children.push(wordTable(chartTable(chart)),paragraph(`Source : ${chart.source??'Source non précisée'}`,true));
  };
  if(report.narrative.length)children.push(heading('Réponse de Mimmoza',HeadingLevel.HEADING_1));
  report.narrative.forEach((block,i)=>{
    if(block.kind==='heading')children.push(heading(block.text));
    else if(block.kind==='paragraph')children.push(paragraph(block.text));
    else if(block.kind==='table')children.push(wordTable(block.table));
    else appendChart(`n-${i}`,block.chart);
  });
  report.sections.forEach((section,s)=>{
    children.push(new Paragraph({text:section.title,heading:HeadingLevel.HEADING_1,pageBreakBefore:true,keepNext:true,spacing:{after:160}}),paragraph(section.status,true),paragraph(`Source : ${section.source}`,true),paragraph(`Périmètre : ${section.scope}`,true),paragraph(section.date,true));
    if(section.url)children.push(linkParagraph(section.url));
    if(section.summary)children.push(paragraph(section.summary));
    if(section.notes.length)children.push(heading('Périmètre et réserves'),...section.notes.map(note=>paragraph(note,true)));
    section.tables.forEach(table=>children.push(heading(table.title),wordTable(table)));
    section.charts.forEach((chart,c)=>appendChart(`s-${s}-${c}`,chart));
  });
  return new Document({creator:'Mimmoza',title:report.title,description:'Export de la réponse et des résultats de ses API',styles:{default:{document:{run:{font:'Aptos',size:22,color:'172238'}}},paragraphStyles:[
    {id:'Title',name:'Title',basedOn:'Normal',run:{font:'Aptos Display',size:48,bold:true,color:'000000'}},
    {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',run:{size:32,bold:true,color:'000000'}},
    {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',run:{size:26,bold:true,color:'000000'}},
  ]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1100,left:1273,right:1273}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'Mimmoza — ',size:18,color:'64748B'}),new TextRun({children:[PageNumber.CURRENT],size:18})]})]})},children}]});
}
export function displayDate(value: string): string { const d=new Date(value);return Number.isNaN(d.getTime())?'Date non précisée':d.toLocaleString('fr-FR'); }
export async function wordBlob(report: ResponseReport,images: ChartImage[]): Promise<Blob> { return Packer.toBlob(buildWordReport(report,images)); }
