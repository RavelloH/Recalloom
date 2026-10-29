import React from 'react';
import {highlightedSegments} from './highlight';
export function SearchHighlight({text,query,enabled=true}:{text:string;query:string;enabled?:boolean}){return <>{(enabled?highlightedSegments(text,query):[{text,matched:false}]).map((p,i)=>p.matched?<mark key={i} className="search-highlight">{p.text}</mark>:<React.Fragment key={i}>{p.text}</React.Fragment>)}</>}
