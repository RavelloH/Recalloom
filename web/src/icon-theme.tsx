import React from 'react';
import type {IconRegistry} from '@astryxdesign/core/Icon';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {Icon} from './icon';

// Astryx controls retain their own layout and accessibility; only SVGs are shared.
const icons:IconRegistry={
 close:<Icon name="x"/>,
 chevronDown:<Icon name="chevronDown"/>,
 chevronLeft:<Icon name="chevronLeft"/>,
 chevronRight:<Icon name="chevronRight"/>,
 chevronsLeft:<Icon name="chevronsLeft"/>,
 chevronsRight:<Icon name="chevronsRight"/>,
 check:<Icon name="check"/>,
 success:<Icon name="success"/>,
 error:<Icon name="error"/>,
 warning:<Icon name="warning"/>,
 info:<Icon name="infoCircle"/>,
 calendar:<Icon name="calendar"/>,
 clock:<Icon name="clock"/>,
 externalLink:<Icon name="externalLink"/>,
 menu:<Icon name="menu2"/>,
 moreHorizontal:<Icon name="dots"/>,
 search:<Icon name="search"/>,
 upload:<Icon name="upload"/>,
 arrowUp:<Icon name="arrowUp"/>,
 arrowDown:<Icon name="arrowDown"/>,
 arrowsUpDown:<Icon name="arrowsSort"/>,
 funnel:<Icon name="filter"/>,
 eyeSlash:<Icon name="eyeOff"/>,
 viewColumns:<Icon name="columns3"/>,
 copy:<Icon name="copy"/>,
 checkDouble:<Icon name="checks"/>,
 wrench:<Icon name="tool"/>,
 stop:<Icon name="stop"/>,
 microphone:<Icon name="microphone"/>
};
export const recalloomTheme={...neutralTheme,icons};
