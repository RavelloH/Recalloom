import type {CriticKind} from './critic-syntax';

/** Applying a review is a deliberate document edit, never a render side effect. */
export type ReviewDecision='accept'|'reject'|'resolve';
export type ReviewResult={text:string;highlight:boolean};
export function resolveCriticSuggestion(
 kind:CriticKind,text:string,before:string,decision:ReviewDecision
):ReviewResult|null{
 if(kind==='comment')return decision==='resolve'?{text:'',highlight:false}:null;
 if(decision==='resolve')return null;
 switch(kind){
  case 'addition':return {text:decision==='accept'?text:'',highlight:false};
  case 'deletion':return {text:decision==='accept'?'':text,highlight:false};
  case 'substitution':return {text:decision==='accept'?text:before,highlight:false};
  case 'highlight':return {text,highlight:decision==='accept'};
  default:return null;
 }
}
