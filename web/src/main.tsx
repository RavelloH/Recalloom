import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from '@tanstack/react-router';
import {Theme} from '@astryxdesign/core/theme';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
// Astryx's generated catalog omits translator-only descriptions while
// preserving all ICU messages, avoiding authoring metadata in the app bundle.
import zhCN from '@astryxdesign/core/locales/zh-CN.generated.js';
import {recalloomTheme} from './icon-theme';
import {router} from './router';
import {queryClient} from './queries';
import {ThemeProvider,useAppearance} from './theme';
import {applyScrollbarPolicy} from './scrollbars';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './styles/index.css';
applyScrollbarPolicy();
// Keep Cap.js proof-of-work self-hosted: no third-party runtime download.
window.CAP_CUSTOM_WASM_URL='/cap-wasm/cap_wasm_bg.wasm';
window.CAP_CUSTOM_HASHWX_URL='/cap-wasm/hashwx.wasm';
function App(){const {mode}=useAppearance();return <InternationalizationProvider locale="zh-CN" messages={{'zh-CN':zhCN}}><Theme theme={recalloomTheme} mode={mode}><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></Theme></InternationalizationProvider>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><App/></ThemeProvider></React.StrictMode>);
