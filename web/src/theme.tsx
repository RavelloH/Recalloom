import React,{createContext,useContext,useEffect,useState} from 'react';
type Mode='light'|'dark'|'system';type Density='comfortable'|'compact';
type Appearance={mode:Mode;setMode:(m:Mode)=>void;density:Density;setDensity:(d:Density)=>void};
const C=createContext<Appearance|null>(null);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [mode,setModeState]=useState<Mode>(()=>{const v=localStorage.getItem('recalloom:mode');return v==='dark'||v==='light'?v:'system';});
 const [density,setDensityState]=useState<Density>(()=>localStorage.getItem('recalloom:density')==='compact'?'compact':'comfortable');
 const setMode=(m:Mode)=>{setModeState(m);localStorage.setItem('recalloom:mode',m);};
 const setDensity=(v:Density)=>{setDensityState(v);localStorage.setItem('recalloom:density',v);};
 useEffect(()=>{document.documentElement.dataset.density=density;},[density]);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const update=()=>{
   const dark=mode==='dark'||(mode==='system'&&media.matches);
   document.documentElement.style.colorScheme=dark?'dark':'light';
   document.documentElement.dataset.effectiveTheme=dark?'dark':'light';
   const themeColor=dark?'#111113':'#ffffff';
   document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content',themeColor);
   document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content',dark?'black':'default');
  };
  update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
 },[mode]);
 return <C.Provider value={{mode,setMode,density,setDensity}}>{children}</C.Provider>;
}
export function useAppearance(){const c=useContext(C);if(!c)throw Error('Appearance provider missing');return c;}
