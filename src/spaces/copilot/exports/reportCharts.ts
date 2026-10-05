import type { ResponseReport, ReportChart } from './responseExportModel';
export type ChartImage={id:string;data:string;width:number;height:number};
const labels=(ctx:CanvasRenderingContext2D,text:string,max:number)=>{let t=text;while(t.length>1&&ctx.measureText(t).width>max)t=t.slice(0,-1);return t===text?t:`${t.trimEnd()}…`;};

/** Graphiques locaux pour Word et Excel ; tableaux numériques conservés à côté. */
export function buildChartImages(report:ResponseReport):ChartImage[]{
  const charts:{id:string;chart:ReportChart}[]=report.narrative.flatMap((b,i)=>b.kind==='chart'?[{id:`n-${i}`,chart:b.chart}]:[]);
  report.sections.forEach((s,i)=>s.charts.forEach((chart,c)=>charts.push({id:`s-${i}-${c}`,chart})));
  const result:ChartImage[]=[];
  for(const {id,chart}of charts){
    for(let start=0;start<chart.rows.length;start+=12){
      const rows=chart.rows.slice(start,start+12),rowHeight=Math.max(48,chart.series.length*25+18),width=1100,height=105+rows.length*rowHeight;
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');if(!ctx)continue;
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#172238';ctx.font='bold 23px Arial';ctx.fillText(labels(ctx,chart.title,1020),24,34);
      ctx.font='16px Arial';ctx.fillStyle='#59647a';ctx.fillText(`${chart.unit || 'Valeurs'}${chart.rows.length>12?` — éléments ${start+1} à ${start+rows.length}`:''}`,24,63);
      const values=chart.rows.flatMap(r=>r.values).filter((v):v is number=>v!==null);
      const low=Math.min(0,...values),high=Math.max(1,...values),scale=high-low,x=300,w=590,zero=x+(0-low)/scale*w;
      rows.forEach((row,r)=>{const y=85+r*rowHeight;ctx.font='17px Arial';ctx.fillStyle='#172238';ctx.fillText(labels(ctx,row.label,265),24,y+20);
        row.values.forEach((value,s)=>{const top=y+s*25;ctx.fillStyle='#edf0f5';ctx.fillRect(x,top,w,16);
          if(value!==null){const end=x+(value-low)/scale*w;const energy:Record<string,string>={A:'#187a45',B:'#4c8739',C:'#808724',D:'#b08012',E:'#b9621b',F:'#bf3f24',G:'#a42d34'};ctx.fillStyle=value<0?'#b84049':energy[row.label]??['#5b55ba','#237b87','#b07723'][s%3];ctx.fillRect(Math.min(zero,end),top,Math.max(0,Math.abs(end-zero)),16);}
          ctx.fillStyle='#172238';ctx.font='15px Arial';ctx.fillText(value===null?'Non renseigné':value.toLocaleString('fr-FR',{maximumFractionDigits:2}),x+w+16,top+14);
          if(chart.series.length>1){ctx.fillStyle='#59647a';ctx.font='12px Arial';ctx.fillText(labels(ctx,chart.series[s],170),x+w+100,top+14);}
        });
      });result.push({id,data:canvas.toDataURL('image/png'),width,height});
    }
  }
  return result;
}
