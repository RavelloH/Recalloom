import {memo,useId} from 'react';
import MarkdownPreview from './markdown-preview';
import {SearchHighlight} from './search-highlight';

function SearchSnippet({text,format,query,enabled}:{text:string;format?:'text'|'markdown';query:string;enabled:boolean}){
 const scope=useId();
 return format==='markdown'
  ?<MarkdownPreview content={text} isSearchPreview idScope={scope} searchQuery={enabled?query:undefined}/>
  :<SearchHighlight text={text} query={query} enabled={enabled}/>;
}

export default memo(SearchSnippet);
