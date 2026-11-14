import React from 'react';
import {Link,useRouter} from '@tanstack/react-router';

/** Keep Astryx links on the same SPA navigation and preload path as route links. */
export function AstryxRouterLink({href,ref,...props}:React.ComponentPropsWithRef<'a'>){
 const router=useRouter();
 if(!href?.startsWith('/')||href.startsWith('//')||props.download!==undefined)
  return <a {...props} href={href} ref={ref}/>;
 const url=new URL(href,location.origin);
 return <Link {...props} ref={ref} to={url.pathname}
  search={router.options.parseSearch(url.search)} hash={url.hash.slice(1)}/>;
}
