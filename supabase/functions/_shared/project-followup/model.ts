export const STAGES = ['cadrage','foncier','etudes','conception','autorisations','financement','commercialisation','travaux','livraison','exploitation','clos'] as const;
export const STAGE_LABELS: Record<typeof STAGES[number], string> = {cadrage:'Cadrage',foncier:'Foncier',etudes:'Études',conception:'Conception',autorisations:'Autorisations',financement:'Financement',commercialisation:'Commercialisation',travaux:'Travaux',livraison:'Livraison',exploitation:'Exploitation',clos:'Clos'};
export type FollowupTask = {id:string;title:string;status:'a_faire'|'en_cours'|'attente'|'termine';owner:string;dueDate:string;lastContactDate:string;blocking:boolean;notes:string};
export type Followup = {version:1;stage:typeof STAGES[number];summary:string;missing:string[];tasks:FollowupTask[]};
const text = (v:unknown,max:number) => typeof v==='string' ? v.trim().slice(0,max) : '';
export function validDate(v:unknown): string { if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';const d=new Date(`${v}T12:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?v:''; }
export function parseFollowup(value:unknown): Followup|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(!STAGES.includes(v.stage as typeof STAGES[number])||!Array.isArray(v.tasks)||v.tasks.length>50||!Array.isArray(v.missing)||v.missing.length>30)return null;
  const ids=new Set<string>();const tasks:FollowupTask[]=[];
  for(const item of v.tasks){if(!item||typeof item!=='object'||Array.isArray(item))return null;const t=item as Record<string,unknown>;const id=text(t.id,80),title=text(t.title,200);
    if(!id||!title||ids.has(id)||!['a_faire','en_cours','attente','termine'].includes(String(t.status)))return null;
    if((t.dueDate&& !validDate(t.dueDate))||(t.lastContactDate&&!validDate(t.lastContactDate)))return null;
    ids.add(id);tasks.push({id,title,status:t.status as FollowupTask['status'],owner:text(t.owner,120),dueDate:validDate(t.dueDate),lastContactDate:validDate(t.lastContactDate),blocking:t.blocking===true,notes:text(t.notes,1000)});
  }
  return {version:1,stage:v.stage as Followup['stage'],summary:text(v.summary,2000),missing:v.missing.map(x=>text(x,300)).filter(Boolean),tasks};
}
export const emptyFollowup = ():Followup => ({version:1,stage:'cadrage',summary:'',missing:[],tasks:[]});
export function followupIndicators(f:Followup,today:string){const open=f.tasks.filter(t=>t.status!=='termine');return{open:open.length,done:f.tasks.length-open.length,blocked:open.filter(t=>t.blocking).length,overdue:open.filter(t=>t.dueDate&&t.dueDate<today),contacts:open.filter(t=>t.status==='attente'&&t.owner)};}
export const FOLLOWUP_SCHEMA = {type:'object' as const,properties:{stage:{type:'string',enum:[...STAGES]},summary:{type:'string'},missing:{type:'array',items:{type:'string'},maxItems:30},tasks:{type:'array',maxItems:50,items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},status:{type:'string',enum:['a_faire','en_cours','attente','termine']},owner:{type:'string'},dueDate:{type:'string',description:'YYYY-MM-DD ou vide. Ne pas inventer un délai légal.'},lastContactDate:{type:'string'},blocking:{type:'boolean'},notes:{type:'string'}},required:['id','title','status','owner','dueDate','lastContactDate','blocking','notes']} }},required:['stage','summary','missing','tasks']};
