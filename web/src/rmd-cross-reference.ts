import {collectCrossRefs,type CrossRefIndex} from './cross-reference';
import {parseRmdVisual} from './rmd-visual';

/** Share the actual source-to-visual semantic AST for all local anchors.
 * A separate token-counting projection previously omitted heading/paragraph
 * and code IDs. Parsing once more is bounded to the current document and
 * eliminates competing definitions of valid reference targets.
 */
export function collectRmdPreviewRefs(source:string):CrossRefIndex{
 return collectCrossRefs(parseRmdVisual(source));
}
