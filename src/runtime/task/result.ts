import {cleanStoredJson} from '../hwm/store';
/** Never let projection claim a stronger execution outcome or task success. */
export function taskResult(value:Record<string,any>){return cleanStoredJson(JSON.parse(JSON.stringify(value))) as Record<string,any>;}
export function actionEvidence(action:Record<string,any>){
 const {snapshot,hwm,changes,log,stack,...rest}=action;
 return rest;
}
