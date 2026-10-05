import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {Packer} from 'docx';
import {buildResponseReport,parseReportText,splitReportText,paginateSlideText} from './responseExportModel';
import {buildExcelReport} from './exportExcel';
import {buildWordReport} from './exportWord';
import {buildPowerPointReport} from './exportPowerPoint';
import {exportTestResponse} from './responseExport.fixture';
const report=()=>buildResponseReport({response:exportTestResponse(),question:'Analyse cette opération fictive.'},'2026-10-05T10:30:00Z');

test('export complet des lignes API, types numériques et valeurs manquantes sans zéro ajouté',()=>{
  const r=report(),dvf=r.sections.find(s=>s.title.includes('DVF'))!;
  assert.equal(dvf.tables.find(t=>t.title==='Ventes comparables')!.rows.length,12);
  assert.equal(dvf.tables[0].rows[0][1],4000);
  assert.equal(dvf.tables[0].rows[2][1],null);
  assert.equal(r.sections.find(s=>s.title==='Recherche sur Internet')!.tables[0].rows[0][1],'https://example.fr/');
  assert.match(r.sections.find(s=>s.title==='Recherche sur Internet')!.notes[0],/partielle/);
});
test('bilan et sensibilités reprennent les chiffres du moteur et leurs unités',()=>{
  const b=report().sections.find(s=>s.title==='Opération fictive pour validation')!;
  assert.equal(b.tables.find(t=>t.title==='Résultats')!.rows.find(r=>r[0]==='Résultat avant fiscalité')![1],250000);
  assert.deepEqual(b.tables.find(t=>t.title==='Sensibilités')!.rows.map(r=>r[3]),[250000,150000,160000,60000]);
  assert.equal(b.tables.find(t=>t.title==='Dépenses par poste')!.rows.at(-1)![1],0);
  assert.match(b.scope,/HT/);
});
test('tableaux markdown, liens et graphes gardent le contenu sans JSON tronqué',()=>{
  const blocks=parseReportText('## Titre\n| Nom | Valeur |\n| --- | --- |\n| A\\|B | 5 |\n\n[Source](https://example.fr)\n```mimmoza-chart\n{"type":');
  assert.equal(blocks[1].kind,'table');
  if(blocks[1].kind==='table')assert.equal(blocks[1].table.rows[0][0],'A|B');
  assert.match(JSON.stringify(blocks),/https:\/\/example.fr/);assert.doesNotMatch(JSON.stringify(blocks),/mimmoza-chart/);
  const text='Dernier mot. '.repeat(300),parts=splitReportText(text,300);
  assert.equal(parts.join(' '),text.trim());assert.ok(parts.every(p=>p.length<=300));
});
test('un outil en erreur n’exporte pas ses anciens chiffres ou ses champs internes',()=>{
  const m=exportTestResponse();m.toolCalls=[{id:'x',name:'get_dvf_comparables',status:'error',output:{status:'error',data:{stats:{price_median_eur_m2:999999},token:'secret'}}}];
  const r=buildResponseReport({response:m});assert.equal(r.sections[0].status,'Source indisponible');assert.equal(r.sections[0].tables.length,0);assert.doesNotMatch(JSON.stringify(r),/999999|secret/);
});
test('les longs avertissements sur plusieurs paragraphes sont paginés sans perte',()=>{
  const text=Array.from({length:15},(_,i)=>`Réserve ${i+1} : ${'conditions précises '.repeat(9)}`).join('\n\n'),pages=paginateSlideText(text);
  assert.ok(pages.length>2);assert.ok(pages.every(p=>p.split('\n').length<=10));assert.match(pages.at(-1)!,/Réserve 15/);
  assert.equal(pages.join(' ').replace(/\s+/g,' ').trim(),text.replace(/\s+/g,' ').trim());
});
test('XLSX relisible : nombres utilisables, cellules absentes vides et texte sans formule injectée',async()=>{
  const r=report();r.narrative.push({kind:'paragraph',text:'=HYPERLINK("javascript:alert(1)")'});
  const workbook=buildExcelReport(r),bytes=await workbook.xlsx.writeBuffer();
  const reload=buildExcelReport({...r,sections:[],narrative:[]});await reload.xlsx.load(bytes);
  let numeric=false,missing=false,formulaText=false,lastComparable=false;
  reload.eachSheet(ws=>ws.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{
    if(cell.value===4000)numeric=true;
    if(cell.value===null)missing=true;
    if(cell.value==='=HYPERLINK("javascript:alert(1)")'){formulaText=true;assert.equal(cell.master.type,3);}
    if(cell.value==='Comparable fictif 12')lastComparable=true;
  })));
  assert.ok(numeric&&missing&&formulaText&&lastComparable);
});
test('DOCX valide : tableaux natifs, accents, dernières lignes et sources',async()=>{
  const zip=await JSZip.loadAsync(await Packer.toBuffer(buildWordReport(report()))),xml=await zip.file('word/document.xml')!.async('string');
  assert.match(xml,/w:tbl/);assert.match(xml,/Comparable fictif 12/);assert.match(xml,/Non renseigné/);assert.match(xml,/Vérification partielle/);assert.match(xml,/250/);assert.match(xml,/Synthèse/);
});
test('PPTX valide : graphiques natifs et pagination conservant le dernier comparable',async()=>{
  const bytes=await buildPowerPointReport(report()).write({outputType:'arraybuffer'}),zip=await JSZip.loadAsync(bytes as ArrayBuffer);
  assert.ok(Object.keys(zip.files).some(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n)));
  const slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));
  const content=(await Promise.all(slides.map(n=>zip.file(n)!.async('string')))).join(' ');
  assert.match(content,/Comparable fictif 12/);assert.match(content,/Données partielles/);assert.match(content,/Non renseigné/);assert.ok(slides.length>5);
});
