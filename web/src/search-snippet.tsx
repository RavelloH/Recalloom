import {memo,useMemo} from 'react';
import {searchMarkdownText} from '../../src/search-markdown';
import {searchSnippet} from '../../src/search-snippet';
import {SearchHighlight} from './search-highlight';

/** Search cards share the Markdown/RMD text projection, evaluated in the browser. */
function SearchSnippet({text,format,query,enabled}:{text:string;format?:'text'|'markdown';query:string;enabled:boolean}){
 const summary=useMemo(()=>format==='markdown'?searchSnippet(query,searchMarkdownText(text)):text,[text,format,query]);
 return <SearchHighlight text={summary} query={query} enabled={enabled}/>;
}

export default memo(SearchSnippet);
