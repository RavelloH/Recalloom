import {parseFigureSuffix,safeFigureImageSrc} from './figure-syntax';

type MdNode={
 type:string;value?:string;url?:string;alt?:string;title?:string;
 children?:MdNode[];
};
type MdRoot={children?:MdNode[]};

/**
 * Upgrade only standalone ![alt](url){width=... caption="..."} paragraphs.
 * A bare Markdown image, inline image or unknown attributes are unchanged.
 * No arbitrary HTML from the author is interpolated into the generated tag.
 */
export function remarkFigureAttributes(){
 return (root:MdRoot)=>{
  const walk=(container:MdRoot)=>{
   for(let i=0;i<(container.children?.length??0);i++){
    const node=container.children![i]!;
    if(node.type==='paragraph'&&node.children?.length===2){
     const [image,tail]=node.children;
     if(image?.type==='image'&&tail?.type==='text'&&
        typeof image.url==='string'&&safeFigureImageSrc(image.url)){
      const attrs=parseFigureSuffix(tail.value??'');
      if(attrs){
       const data=encodeURIComponent(JSON.stringify({
        src:image.url,alt:image.alt??'',title:image.title??'',
        width:attrs.width,height:attrs.height,caption:attrs.caption,id:attrs.id??null
       }));
       container.children![i]={type:'html',value:'<rk-figure data-payload="'+data+'"></rk-figure>'};
       continue;
      }
     }
    }
    if(node.children)walk(node);
   }
  };
  walk(root);
 };
}
