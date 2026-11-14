import {markdownCharacterCount} from './document-heading';

type CountRequest={id:number;markdown:string};
type CountResponse={id:number;characters:number}|{id:number;error:true};

const scope=globalThis as unknown as {
 addEventListener:(type:'message',listener:(event:{data:CountRequest})=>void)=>void;
 postMessage:(message:CountResponse)=>void;
};

scope.addEventListener('message',event=>{
 const {id,markdown}=event.data;
 try{
  scope.postMessage({id,characters:markdownCharacterCount(markdown)});
 }catch{
  scope.postMessage({id,error:true});
 }
});
