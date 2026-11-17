import {memo,useId} from 'react';
import MarkdownPreview from './markdown-preview';
import {SearchHighlight} from './search-highlight';

function SearchSnippet({text,format,query,enabled,sourceId}:{text:string;format?:'text'|'markdown';query:string;enabled:boolean;sourceId:string}){
 const scope=useId();
 return format==='markdown'
  ?<MarkdownPreview content={text} sourceId={sourceId} depth={1} embedded idScope={scope} searchQuery={enabled?query:undefined}/>
  :<div className="rmd-preview-surface"><article className="markdown-preview" data-embedded><p className="search-text-snippet"><SearchHighlight text={text} query={query} enabled={enabled}/></p></article></div>;
}

export default memo(SearchSnippet);
