import React from 'react';
import {IconNote,IconInfoCircle,IconBulb,IconCircleCheck,IconAlertTriangle,IconAlertOctagon,IconBook2,IconHelpCircle,type TablerIcon} from '@tabler/icons-react';

/** Distinct Tabler glyphs for each RMD semantic kind; one shared 16px Banner slot. */
const icons:Record<string,TablerIcon>={
 note:IconNote,info:IconInfoCircle,tip:IconBulb,success:IconCircleCheck,
 warning:IconAlertTriangle,danger:IconAlertOctagon,example:IconBook2,question:IconHelpCircle
};
/** Supply the semantic icon through Banner's own `icon` prop.
 * Putting another icon in title duplicates Banner's status icon. */
export function calloutIcon(kind:string):React.ReactNode{
 const Icon=icons[kind];
 return Icon?<Icon size="var(--rk-icon-sm)" stroke={2} aria-hidden="true"/>:undefined;
}
