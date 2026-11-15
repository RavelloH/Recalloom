/** User agents are display hints, not verified device identities. */
export function sessionLabel(agent:string){
 const platform=/iPad/.test(agent)?'iPad':/iPhone/.test(agent)?'iPhone':/Android/.test(agent)?'Android':/Windows/.test(agent)?'Windows':/Macintosh|Mac OS X/.test(agent)?'macOS':/Linux/.test(agent)?'Linux':'未知设备';
 const browser=/Edg(?:A|iOS)?\//.test(agent)?'Edge':/Firefox\/|FxiOS\//.test(agent)?'Firefox':/OPR\//.test(agent)?'Opera':/Chrome\/|CriOS\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':'未知浏览器';
 return {platform,browser};
}
