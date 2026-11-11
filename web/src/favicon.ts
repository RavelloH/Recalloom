/**
 * Select a concrete monochrome SVG for the browser tab.
 * A CSS media query inside an SVG favicon isn't honored by every browser,
 * so changing the link URL also covers those engines.
 * Follow browser chrome color preference, not the site's manual theme.
 */
export function installAdaptiveFavicon(){
 const icon=document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
 if(!icon)return;
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 const update=()=>{
  const target=media.matches?'/recalloom-logo-dark.svg':'/recalloom-logo-light.svg';
  if(icon.getAttribute('href')!==target)icon.setAttribute('href',target);
 };
 update();
 media.addEventListener('change',update);
}
