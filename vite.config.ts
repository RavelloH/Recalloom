import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'web',plugins:[react()],build:{outDir:'../dist/web',emptyOutDir:true},server:{port:5173,proxy:{'/api':'http://127.0.0.1:8787','/mcp':'http://127.0.0.1:8787','/authorize':'http://127.0.0.1:8787','/oauth':'http://127.0.0.1:8787','/.well-known':'http://127.0.0.1:8787'}}});
