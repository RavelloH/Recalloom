import {memo,useEffect,useMemo,useRef} from 'react';
import {Chart,ChartAxis,ChartGrid,bar,useChart,useChartColors} from '@astryxdesign/charts';
import '@astryxdesign/charts/charts.css';
import {Selector} from '@astryxdesign/core/Selector';
import type {ISODateString} from '@astryxdesign/core/Calendar';
import {actorLabels,type ActivityAgent,type ActivityDay} from './data';

const kinds=['system','unknown'] as const;
type Selection={selectedDay:ISODateString|null;onSelect:(day:ISODateString|null)=>void};
const shortDate=(value:unknown)=>{const day=String(value);return Number(day.slice(5,7))+'/'+Number(day.slice(8));};

/** Use the library's scales for hit testing, including days with zero changes. */
function DaySelection({onSelect}:Pick<Selection,'onSelect'>){
 const {svgRef,xScale,data,xKey,margin,width,height}=useChart();
 useEffect(()=>{
  const svg=svgRef.current;if(!svg||!('bandwidth' in xScale))return;
  const select=(event:MouseEvent)=>{
   const matrix=svg.getScreenCTM()?.inverse();if(!matrix)return;
   const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
   const local=point.matrixTransform(matrix),x=local.x-margin.left,y=local.y-margin.top;
   if(x<0||x>width||y<0||y>height)return;
   const closest=data.reduce<{day:ISODateString;distance:number}|null>((best,row)=>{
    const day=String(row[xKey]) as ISODateString,position=xScale(day);if(position==null)return best;
    const distance=Math.abs(x-position-xScale.bandwidth()/2);
    return !best||distance<best.distance?{day,distance}:best;
   },null);
   if(closest)onSelect(closest.day);
  };
  svg.addEventListener('click',select);return()=>svg.removeEventListener('click',select);
 },[svgRef,xScale,data,xKey,margin,width,height,onSelect]);
 return null;
}

export const ActivityChart=memo(function ActivityChart({days,agents,selectedDay,onSelect}:Selection&{days:ActivityDay[];agents:ActivityAgent[]}){
 const scroll=useRef<HTMLDivElement>(null);
 const colors=useChartColors();
 useEffect(()=>{const element=scroll.current;if(element)element.scrollLeft=element.scrollWidth;},[days.length,days[0]?.day]);
 const total=days.reduce((sum,day)=>sum+day.total,0);
 const entries=useMemo(()=>{
  const palette=colors.categorical(agents.length);
  return [{key:'user',label:actorLabels.user,color:'var(--activity-user)'},
   ...agents.map((agent,index)=>({key:'agent:'+agent.actorKey,label:agent.actorName,color:palette[index]})),
   ...kinds.filter(kind=>kind!=='unknown'||days.some(day=>day.unknown>0)).map(kind=>({key:kind,label:actorLabels[kind],color:'var(--activity-'+kind+')'}))];
 },[agents,days,colors]);
 const data=useMemo(()=>days.map(day=>({...day,...Object.fromEntries(agents.map(agent=>['agent:'+agent.actorKey,day.agents[agent.actorKey]??0]))})),[days,agents]);
 const series=useMemo(()=>entries.map(entry=>bar(entry.key,{stack:'changes',label:entry.label,radius:3,color:entry.color})),[entries]);
 return <figure className="activity-chart" aria-label="每日变更趋势">
  <figcaption className="activity-section-heading"><div><h2>变更趋势</h2><p className="muted">每天的知识库变更 · 点击柱状图查看当天活动</p></div>
   <Selector label="查看某一天的活动" isLabelHidden size="sm" variant="ghost" value={selectedDay??'all'}
    options={[{value:'all',label:total+' 次变更'},...days.map(day=>({value:day.day,label:day.day+' · '+day.total+' 次'}))]}
    onChange={value=>onSelect(value==='all'?null:value as ISODateString)} hasSearch presentation="adaptive"/>
  </figcaption>
  <div ref={scroll} className="activity-chart-scroll"><Chart className="activity-chart-canvas" style={{minWidth:Math.max(520,days.length*17)}}
   data={data} xKey="day" series={series} height={200} margin={{top:12,left:36,right:12,bottom:28}}
   aria-label="每日变更次数，按本人、各个 Agent 和系统堆叠显示" yDomain={days.every(day=>day.total===0)?[0,1]:undefined}
   grid={<ChartGrid tickCount={3}/>}
   axes={<><ChartAxis position="bottom" maxTicks={8} tickFormat={shortDate}/><ChartAxis position="left" tickCount={3} tickFormat={value=>Number.isInteger(Number(value))?String(value):''}/></>}
   tooltip legend={{alignment:'center',items:entries.map(entry=>({label:entry.label,color:entry.color,type:'bar'}))}}
   interactions={<DaySelection onSelect={day=>onSelect(selectedDay===day?null:day)}/>}/></div>
 </figure>;
});
