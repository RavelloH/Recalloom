import React from 'react';
import type {IconRegistry} from '@astryxdesign/core/Icon';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {Icon} from './icon';
import {
 IconX,IconChevronDown,IconChevronLeft,IconChevronRight,IconChevronsLeft,IconChevronsRight,
 IconCheck,IconCircleCheck,IconCircleX,IconAlertTriangle,IconInfoCircle,IconCalendar,IconClock,
 IconExternalLink,IconMenu2,IconDots,IconUpload,IconArrowUp,IconArrowDown,
 IconArrowsSort,IconFilter,IconEyeOff,IconColumns3,IconCopy,IconChecks,IconTool,
 IconSquare,IconMicrophone
} from '@tabler/icons-react';

// Astryx still owns behavior, accessibility and layout. Override only its
// semantic icon registry, preserving the precompiled neutral theme/CSS.
const glyph={size:'var(--rk-icon-sm)',stroke:2,'aria-hidden':true} as const;

const icons:IconRegistry={
 close:<IconX {...glyph}/>,
 chevronDown:<IconChevronDown {...glyph}/>,
 chevronLeft:<IconChevronLeft {...glyph}/>,
 chevronRight:<IconChevronRight {...glyph}/>,
 chevronsLeft:<IconChevronsLeft {...glyph}/>,
 chevronsRight:<IconChevronsRight {...glyph}/>,
 check:<IconCheck {...glyph}/>,
 success:<IconCircleCheck {...glyph}/>,
 error:<IconCircleX {...glyph}/>,
 warning:<IconAlertTriangle {...glyph}/>,
 info:<IconInfoCircle {...glyph}/>,
 calendar:<IconCalendar {...glyph}/>,
 clock:<IconClock {...glyph}/>,
 externalLink:<IconExternalLink {...glyph}/>,
 menu:<IconMenu2 {...glyph}/>,
 moreHorizontal:<IconDots {...glyph}/>,
 search:<Icon name="search" size="sm"/>,
 upload:<IconUpload {...glyph}/>,
 arrowUp:<IconArrowUp {...glyph}/>,
 arrowDown:<IconArrowDown {...glyph}/>,
 arrowsUpDown:<IconArrowsSort {...glyph}/>,
 funnel:<IconFilter {...glyph}/>,
 eyeSlash:<IconEyeOff {...glyph}/>,
 viewColumns:<IconColumns3 {...glyph}/>,
 copy:<IconCopy {...glyph}/>,
 checkDouble:<IconChecks {...glyph}/>,
 wrench:<IconTool {...glyph}/>,
 stop:<IconSquare {...glyph}/>,
 microphone:<IconMicrophone {...glyph}/>
};

export const recalloomTheme={...neutralTheme,icons};
