const commands=new Set(['snapshot','list','forms','click','hover','fill','select','press','batch','goto','back','forward','scroll','wait-idle','wait-for','dismiss-annoyances','extract','eval','diff','view','expand','changes']);
export function outputFormat(command,explicit,environment=process.env.WEBAGENT_OUTPUT_FORMAT){
 const chosen=explicit??environment;if(chosen!==undefined){if(!['json','hwm'].includes(chosen))throw new Error('format must be json or hwm');return chosen;}
 return commands.has(command)?'hwm':'json';
}
