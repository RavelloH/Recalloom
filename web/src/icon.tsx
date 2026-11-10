import React from 'react';
import {IconLayoutDashboard,IconFolderOpen,IconChecklist,IconSearch,IconActivity,IconArchive,IconTopologyStar3,IconBook2,IconSettings,IconSunMoon,IconLogout,IconFileText,IconHistory,IconDatabaseExport,IconPlus,IconPencil,IconRestore,IconTag,IconTrash,IconArrowUpRight,IconArrowDownLeft,IconSparkles} from '@tabler/icons-react';
export const glyphs={overview:IconLayoutDashboard,folder:IconFolderOpen,taskList:IconChecklist,search:IconSearch,activity:IconActivity,archive:IconArchive,graph:IconTopologyStar3,help:IconBook2,settings:IconSettings,theme:IconSunMoon,logout:IconLogout,document:IconFileText,versionHistory:IconHistory,backup:IconDatabaseExport,create:IconPlus,update:IconPencil,restore:IconRestore,tag:IconTag,remove:IconTrash,outgoing:IconArrowUpRight,incoming:IconArrowDownLeft,semantic:IconSparkles} as const;
export type IconName=keyof typeof glyphs;
export type IconSize='sm'|'md'|'lg';
const sizes={sm:16,md:20,lg:24} as const;
export function Icon({name,size='md',inline=false,className}: {name:IconName;size?:IconSize;inline?:boolean;className?:string}){
 const Glyph=glyphs[name];const dimension=inline?'1em':sizes[size];
 return <span className={'rk-icon'+(inline?' rk-icon--inline':'')+(className?' '+className:'')} style={{width:dimension,height:dimension}} aria-hidden="true"><Glyph size={dimension} stroke={2}/></span>;
}
