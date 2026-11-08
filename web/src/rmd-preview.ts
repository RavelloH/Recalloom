import {findCriticMarkup} from './critic-syntax';
import {projectRmdComments} from './rmd-comment';

/** Render the confirmed document, never auto-accept pending CriticMarkup. */
export function projectConfirmedCriticMarkup(source:string):string{
 const matches=findCriticMarkup(source);
 if(!matches.length)return source;
 let out=source;
 for(const {start,end,match} of matches.slice().reverse()){
  const text=match.kind==='deletion'||match.kind==='substitution'?match.kind==='deletion'?match.text:match.before:
   match.kind==='highlight'?match.text:'';
  out=out.slice(0,start)+text+out.slice(end);
 }
 return out;
}
/** Read-only projection used by both record preview and wiki transclusions. */
export function projectRmdPreview(source:string):string{
 return projectConfirmedCriticMarkup(projectRmdComments(source));
}
