import {useMemo} from 'react';
import {Chart,ChartAxis,ChartGrid,bar,line,useChartColors} from '@astryxdesign/charts';
import '@astryxdesign/charts/charts.css';
import {Card} from '@astryxdesign/core/Card';
import {Empty,fmt} from './pages/shared';
import type {Point} from './index-status-data';

export function IndexChart({title,description,data,fields,kind='line',format}:{title:string;description:string;data:Point[];fields:Array<{key:string;label:string}>;kind?:'line'|'bar';format?:(n:number)=>string}){
 const colors=useChartColors();
 const series=useMemo(()=>{const palette=colors.categorical(fields.length);return fields.map((field,index)=>{
  const color=field.key==='completed'?colors.semantic.positive:field.key==='failed'?colors.semantic.negative:field.key==='pending'?colors.semantic.neutral:palette[index];
  return kind==='bar'?bar(field.key,{label:field.label,color,stack:'outcomes',radius:3}):line(field.key,{label:field.label,color,dots:data.length<3,curve:'linear'});
 });},[fields,kind,colors,data.length]);
 const maximum=Math.max(1,...data.map(row=>kind==='bar'?fields.reduce((sum,f)=>sum+(typeof row[f.key]==='number'?row[f.key] as number:0),0):Math.max(0,...fields.map(f=>typeof row[f.key]==='number'?row[f.key] as number:0))));
 return <Card padding={4} className="index-chart-card"><h3>{title}</h3><p className="muted small">{description}</p>{!data.length?<Empty title="暂无历史采样" description="启用后开始记录，不回填历史数据。"/>:<Chart data={data} xKey="time" series={series} yDomain={[0,maximum]} height={200} margin={{top:12,left:format?76:44,right:16,bottom:30}} aria-label={title}
 grid={<ChartGrid tickCount={3}/>} axes={<><ChartAxis position="bottom" maxTicks={3} tickFormat={v=>{const s=String(v);return s.includes('T')?fmt(s):s.slice(5,10);}}/><ChartAxis position="left" tickCount={3} tickFormat={v=>format?format(Number(v)):Number.isInteger(Number(v))?String(v):''}/></>} tooltip legend/>}</Card>;
}
