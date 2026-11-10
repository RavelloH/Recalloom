import React from 'react';
import {Icon,type IconName} from './icon';

/** The Banner owns the visual icon slot; no additional SVG wrapper is needed. */
const kinds:Record<string,IconName>={
 note:'note',info:'infoCircle',tip:'bulb',success:'success',
 warning:'warning',danger:'danger',example:'helpBook',question:'question'
};

export function calloutIcon(kind:string):React.ReactNode{
 const name=kinds[kind];
 return name?<Icon name={name} size="sm" aria-hidden="true"/>:undefined;
}
