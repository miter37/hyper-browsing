import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/** A fresh pause for each actual input, including the first one. Read observations are not paced. */
export function sampleInputDelayMs(): number { return randomInt(500, 1001); }
export async function waitBeforeInput(): Promise<void> { await sleep(sampleInputDelayMs()); }
const pacedToken=Symbol('input-paced');
/** Internal capability: callers that already paced before discovery must not pause again. */
export async function paceBeforeTarget():Promise<symbol>{await waitBeforeInput();return pacedToken;}
export function inputAlreadyPaced(token:unknown):boolean{return token===pacedToken;}
