import React,{useEffect,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion,type TargetAndTransition} from 'motion/react';

/* Adapted from InsightFlare's AutoTransition / AutoResizer: content swaps
   fade instead of popping, and containers ease to their new size instead of
   pushing the rest of the page down in a single frame. */
const ease=[0.22,1,0.36,1] as const;
type Variant={initial:TargetAndTransition;animate:TargetAndTransition;exit:TargetAndTransition};
const variants:Record<'fade'|'slideUp'|'scale',Variant>={
 fade:{initial:{opacity:0},animate:{opacity:1},exit:{opacity:0}},
 slideUp:{initial:{opacity:0,y:8},animate:{opacity:1,y:0},exit:{opacity:0,y:-4}},
 scale:{initial:{opacity:0,scale:.97},animate:{opacity:1,scale:1},exit:{opacity:0,scale:.97}}
};

export function AutoTransition({transitionKey,children,type='fade',duration=.18,initial=false,mode='wait',className,as='div'}:{
 transitionKey:string|number;children:React.ReactNode;type?:keyof typeof variants;duration?:number;initial?:boolean;
 mode?:'wait'|'sync'|'popLayout';className?:string;as?:'div'|'span';
}){
 const reduce=useReducedMotion();
 const Component=as==='span'?motion.span:motion.div;
 const v=variants[type];
 return <AnimatePresence mode={mode} initial={initial}>
  <Component key={transitionKey} className={className} initial={v.initial} animate={v.animate} exit={v.exit} transition={{duration:reduce?0:duration,ease}}>{children}</Component>
 </AnimatePresence>;
}

/** Animates height (and optionally width) to follow its content. The first measurement never animates. */
export function AutoResizer({children,className,duration=.24,animateWidth=false,animateHeight=true}:{
 children:React.ReactNode;className?:string;duration?:number;animateWidth?:boolean;animateHeight?:boolean;
}){
 const content=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState<{height:number|'auto';width:number|'auto';settled:boolean}>({height:'auto',width:'auto',settled:false});
 const reduce=useReducedMotion();
 useEffect(()=>{
  const el=content.current;
  if(!el)return;
  let frame=0;
  const measure=()=>{
   frame=0;
   const height=animateHeight?el.offsetHeight:'auto' as const,width=animateWidth?el.scrollWidth:'auto' as const;
   setSize(prev=>prev.height===height&&prev.width===width?prev:{height,width,settled:prev.height!=='auto'||prev.width!=='auto'});
  };
  measure();
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const observer=new ResizeObserver(schedule);
  observer.observe(el);
  return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);};
 },[animateHeight,animateWidth]);
 const target:{height?:number|'auto';width?:number|'auto'}={};
 if(animateHeight)target.height=size.height;
 if(animateWidth)target.width=size.width;
 return <motion.div className={className} style={{overflow:'hidden',display:animateWidth?'inline-flex':undefined,verticalAlign:animateWidth?'middle':undefined}}
  initial={false} animate={target} transition={{duration:size.settled&&!reduce?duration:0,ease}}>
  <div ref={content} style={animateWidth?{display:'inline-block',width:'max-content',flexShrink:0}:{display:'flow-root'}}>{children}</div>
 </motion.div>;
}
