import React,{useId,useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {TabList,Tab} from '@astryxdesign/core/TabList';

type TabChildProps={'data-kind'?:string;'data-title'?:string;children?:React.ReactNode};
/** Read-only Astryx tabs. ReactMarkdown's nested rk-callout elements retain
 * data-kind and data-title on their React element props, before rendering.
 */
export function TabsPreview({children}:{children:React.ReactNode}){
 const nodes=React.Children.toArray(children);
 const items=nodes.filter((node):node is React.ReactElement<TabChildProps>=>
  React.isValidElement(node)&&(node.props as TabChildProps)['data-kind']==='tab');
 const other=nodes.filter(node=>!items.includes(node as React.ReactElement<TabChildProps>));
 const [selected,setSelected]=useState('0');
 const id=useId().replace(/:/g,'-');
 const current=items[Math.min(Math.max(0,Number(selected)||0),items.length-1)];
 if(!items.length)return <Card variant="muted" padding={3}>{children}</Card>;
 return <Card variant="default" padding={3} className="rk-tabs-preview" data-rk-tabs="">
  <TabList value={current?String(items.indexOf(current)):'0'} onChange={setSelected} role="tablist" hasDivider>
   {items.map((item,index)=><Tab key={index} id={id+'-tab-'+index} value={String(index)}
     panelId={id+'-panel-'+index} label={item.props['data-title']||'标签 '+(index+1)}/>)}
  </TabList>
  {items.map((item,index)=><section key={index} id={id+'-panel-'+index} role="tabpanel"
    aria-labelledby={id+'-tab-'+index} hidden={item!==current}
    className="rk-tabs-read-panel">{item}</section>)}
  {other.length>0&&<div className="rk-tabs-unscoped">{other}</div>}
 </Card>;
}
