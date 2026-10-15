const commands=new Set(['snapshot','list','forms','click','hover','fill','select','press','batch','goto','back','forward','scroll','wait-idle','wait-for','dismiss-annoyances','extract','eval','diff','view','expand','changes']);
export function outputFormat(command,explicit,environment=process.env.WEBAGENT_OUTPUT_FORMAT){
 const chosen=explicit??environment;if(chosen!==undefined){if(!['hb','json','hwm'].includes(chosen))throw new Error('format must be hb, json or hwm');return chosen;}
 if(command==='explain'||['view','expand','changes','diff'].includes(command))return 'hwm';
 return commands.has(command)||['read','find','run'].includes(command)?'hb':'json';
}
