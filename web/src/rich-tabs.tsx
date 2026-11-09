import React,{useId,useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {TabList,Tab} from '@astryxdesign/core/TabList';
import {richTitle} from './tiptap/rich-schema';

type TabChildProps={'data-kind'?:string;'data-title'?:string;children?:React.ReactNode};
/** Read-only Tabs projection mirrors the VisualEditor card, title, and active
 * pane presentation without including any authoring controls. */
export function TabsPreview({children,title}:{children:React.ReactNode;title?:string}){
 const nodes=React.Children.toArray(children);
 const items=nodes.filter((node):node is React.ReactElement<TabChildProps>=>
  React.isValidElement(node)&&(node.props as TabChildProps)['data-kind']==='tab');
 const other=nodes.filter(node=>!items.includes(node as React.ReactElement<TabChildProps>));
 const [selected,setSelected]=useState('0');
 const id=useId().replace(/:/g,'-');
 const current=items[Math.min(Math.max(0,Number(selected)||0),items.length-1)];
 if(!items.length)return <Card variant="muted" padding={3}>{children}</Card>;
 return <Card variant="default" padding={3} className="rk-tabs-preview" data-rk-tabs="">
  <div className="rk-tabs-heading">{richTitle('tabs',title)}</div>
  <TabList value={current?String(items.indexOf(current)):'0'} onChange={setSelected} hasDivider>
   {items.map((item,index)=><Tab key={index} id={id+'-tab-'+index} value={String(index)}
     panelId={id+'-panel-'+index} label={item.props['data-title']||'标签 '+(index+1)}/>)}
  </TabList>
  {items.map((item,index)=><section key={index} id={id+'-panel-'+index} role="tabpanel"
    aria-labelledby={id+'-tab-'+index} hidden={item!==current}
    className="rk-tabs-read-panel">
    <Card variant="muted" padding={3} className="rk-tab-edit">
     <div className="rk-tab-title">{richTitle('tab',item.props['data-title'])}</div>
     {item}
    </Card>
   </section>)}
  {other.length>0&&<div className="rk-tabs-unscoped">{other}</div>}
 </Card>;
}
