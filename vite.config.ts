import {defineConfig,type ProxyOptions} from 'vite';
import react from '@vitejs/plugin-react';

/** Local dev only: Vite forwards browser-origin requests to the local Worker.
 * Rewrite Origin solely for calls originating from this exact dev server.
 * Cross-site requests retain their Origin and must fail checkOrigin(). */
const target='http://127.0.0.1:8787';
const uiOrigin='http://127.0.0.1:5173';
const workerProxy:ProxyOptions={
 target,changeOrigin:true,
 configure(proxy){
  proxy.on('proxyReq',(proxyReq,req)=>{
   if(req.headers.origin===uiOrigin)proxyReq.setHeader('Origin',target);
  });
 }
};

export default defineConfig({
 root:'web',
 plugins:[react()],
 build:{outDir:'../dist/web',emptyOutDir:true,rollupOptions:{output:{
  // Keep the shared document motion module independent when new Astryx
  // primitives change Rollup's automatic shared-chunk grouping.
  onlyExplicitManualChunks:true,
  manualChunks:id=>id.replaceAll('\\','/').endsWith('/web/src/motion-primitives.tsx')?'motion-primitives':undefined
 }}},
 server:{
  host:'127.0.0.1',
  port:5173,
  proxy:{
   '/api':workerProxy,
   '/mcp':workerProxy,
   '/authorize':workerProxy,
   '/oauth':workerProxy,
   '/.well-known':workerProxy
  }
 }
});
