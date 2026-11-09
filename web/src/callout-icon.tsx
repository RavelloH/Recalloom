import React from 'react';
import {IconNote,IconInfoCircle,IconBulb,IconCircleCheck,IconAlertTriangle,IconShieldExclamation,IconBook2,IconHelpCircle,type TablerIcon} from '@tabler/icons-react';

/** Preserve every callout type, while sharing the four Astryx Banner statuses. */
const icons:Record<string,TablerIcon>={
 note:IconNote,info:IconInfoCircle,tip:IconBulb,success:IconCircleCheck,
 warning:IconAlertTriangle,danger:IconShieldExclamation,example:IconBook2,question:IconHelpCircle
};
/** Supply the semantic icon through Banner's own `icon` prop.
 * Putting another icon in title duplicates Banner's status icon. */
export function calloutIcon(kind:string):React.ReactNode{
 const Icon=icons[kind];
 return Icon?<Icon size="1em" stroke={2} aria-hidden="true"/>:undefined;
}
