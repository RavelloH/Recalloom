import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from '@tanstack/react-router';
import {Theme} from '@astryxdesign/core/theme';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import {LinkProvider} from '@astryxdesign/core/Link';
// Astryx's generated catalog omits translator-only descriptions while
// preserving all ICU messages, avoiding authoring metadata in the app bundle.
import zhCN from '@astryxdesign/core/locales/zh-CN.generated.js';
import {recalloomTheme} from './icon-theme';
import {AstryxRouterLink} from './astryx-router-link';
import {router} from './router';
import {queryClient} from './queries';
import {ThemeProvider,useAppearance} from './theme';
import {applyScrollbarPolicy,prepareScrollbars} from './scrollbars';
import {installPairedTransitionLifecycle} from './shared-view-transition';
import {installAdaptiveFavicon} from './favicon';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './styles/index.css';
applyScrollbarPolicy();
installAdaptiveFavicon();
// Keep Cap.js proof-of-work self-hosted: no third-party runtime download.
window.CAP_CUSTOM_WASM_URL='/cap-wasm/cap_wasm_bg.wasm';
window.CAP_CUSTOM_HASHWX_URL='/cap-wasm/hashwx.wasm';
function App(){const {mode}=useAppearance();return <InternationalizationProvider locale="zh-CN" messages={{'zh-CN':zhCN}}><Theme theme={recalloomTheme} mode={mode}><LinkProvider component={AstryxRouterLink}><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></LinkProvider></Theme></InternationalizationProvider>;}
// Start the overlay engine fetch alongside the auth query, not ahead of the
// entire React app. The route root gates only the authenticated scroll shell;
// login and the initial connection UI never wait for this optional chunk.
installPairedTransitionLifecycle();
if(location.pathname!=='/login')void prepareScrollbars();
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><App/></ThemeProvider></React.StrictMode>);
