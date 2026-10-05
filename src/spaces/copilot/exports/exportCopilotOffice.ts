import type { ChatMessage } from '../types/copilot.types';
import { buildResponseReport } from './responseExportModel';
export type OfficeFormat='xlsx'|'docx'|'pptx';

export async function exportCopilotOffice(format:OfficeFormat,params:{response:ChatMessage;question?:string|null}):Promise<void>{
  const report=buildResponseReport(params);let blob:Blob;
  if(format==='pptx'){const {powerPointBlob}=await import('./exportPowerPoint');blob=await powerPointBlob(report);}
  else{
    const {buildChartImages}=await import('./reportCharts'),images=buildChartImages(report);
    if(format==='xlsx'){const {excelBlob}=await import('./exportExcel');blob=await excelBlob(report,images);}
    else{const {wordBlob}=await import('./exportWord');blob=await wordBlob(report,images);}
  }
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`Mimmoza-analyse-${report.exportDate.slice(0,10)}.${format}`;document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
