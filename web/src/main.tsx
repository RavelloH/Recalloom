import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from '@tanstack/react-router';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {router} from './router';
import {ThemeProvider,useAppearance} from './theme';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './style.css';
import './design-system.css';
import './motion.css';
// Keep Cap.js proof-of-work self-hosted: no third-party runtime download.
window.CAP_CUSTOM_WASM_URL='/cap-wasm/cap_wasm_bg.wasm';
window.CAP_CUSTOM_HASHWX_URL='/cap-wasm/hashwx.wasm';
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15_000,refetchOnWindowFocus:false}}});
function App(){const {mode}=useAppearance();return <Theme theme={neutralTheme} mode={mode}><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></Theme>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><App/></ThemeProvider></React.StrictMode>);
