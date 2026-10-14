import type { Page } from "playwright";
import type { SiteDefinition, VerifyDefinition } from "../schema/site";
import type { VerificationOutcome } from "../runtime/metrics";
import { detectState } from "./state";
import { evaluateCondition } from "./conditions";
import { z } from 'zod';
import { LocatorStrategySchema } from '../schema/site';
import { resolveUnique } from './locators';
import { referencesFor, targetFor, type ActionTarget } from '../runtime/references';
import { captureSnapshot } from '../runtime/snapshot';
import { redactText } from '../utils/strings';

export interface VerificationResult {
  outcome: VerificationOutcome;
  details: Array<{ condition: unknown; ok?: boolean; error?: string }>;
}

export async function verifyAction(page: Page, site: SiteDefinition, verify: VerifyDefinition[], vars: Record<string, unknown>): Promise<VerificationResult> {
  if (!verify.length) return { outcome: "UNKNOWN", details: [] };
  const details: VerificationResult["details"] = [];
  let unknown = false;
  for (const condition of verify as any[]) {
    try {
      let ok: boolean;
      if (condition.type === "state_is") ok = (await detectState(page, site)).state === condition.state;
      else ok = await evaluateCondition(page, site, condition as any, vars);
      details.push({ condition, ok });
    } catch (error: any) {
      unknown = true;
      details.push({ condition, error: error?.message || String(error) });
    }
  }
  return { outcome: details.some(d=>d.ok===false) ? 'NOT_APPLIED' : unknown ? "UNKNOWN" : "APPLIED", details };
}

const TargetSchema=z.object({locator:LocatorStrategySchema.optional(),ref:z.string().regex(/^@?e\d+$/).optional(),nth:z.number().int().nonnegative().optional(),within:z.string().optional()}).strict()
 .refine(v=>Boolean(v.locator)!==Boolean(v.ref),'Use one locator or ref').refine(v=>!v.ref||(v.nth===undefined&&!v.within),'References cannot be scoped');
const FieldCheck=z.object({type:z.literal('element'),target:TargetSchema,read:z.enum(['text','value','attribute','checked','selected']),attribute:z.string().optional(),op:z.enum(['equals','contains','exists']),expected:z.union([z.string(),z.boolean()]).optional()}).strict()
 .refine(c=>c.read!=='attribute'||Boolean(c.attribute),'Attribute name required')
 .refine(c=>c.op==='exists'||c.expected!==undefined,'Expected value required')
 .refine(c=>c.op==='exists'||(c.read==='checked'||c.read==='selected'?typeof c.expected==='boolean':typeof c.expected==='string'),'Expected value type must match the read')
 .refine(c=>c.op!=='contains'||typeof c.expected==='string','Contains requires text');
export const PageVerificationSchema=z.object({checks:z.array(z.union([z.object({type:z.literal('url_param'),name:z.string().min(1),expected:z.string()}).strict(),FieldCheck])).max(20)}).strict();

/** Explicit, ephemeral, read-only assertions. No learning or asset persistence. */
export async function verifyPage(page:Page,input:unknown):Promise<Record<string,any>> {
 const parsed=PageVerificationSchema.safeParse(input);
 if(!parsed.success)return {ok:false,execution:'not_started',reason:'invalid_verification',outcome:'UNKNOWN',error:parsed.error.issues.map(i=>i.message).join('; '),details:[]};
 const deadline=Date.now()+5000;
 let timer:ReturnType<typeof setTimeout>;
 try { return await Promise.race([verifyPageChecks(page,parsed.data.checks,deadline),new Promise<Record<string,any>>(r=>{timer=setTimeout(()=>r({ok:false,execution:'completed',outcome:'UNKNOWN',reason:'verification_budget',details:[]}),5000);})]);
 } finally { clearTimeout(timer!); }
}
async function verifyPageChecks(page:Page,checks:z.infer<typeof PageVerificationSchema>['checks'],deadline:number):Promise<Record<string,any>> {
 const snap=await captureSnapshot(page,{limit:1,waitMs:0});
 const pageState=snap.pageState;
 if(!checks.length||pageState?.state!=='ready')return {ok:false,execution:'completed',outcome:'UNKNOWN',pageState,details:checks.map((c,index)=>({index,type:c.type,error:'page_not_ready'}))};
 const document=await page.evaluateHandle(()=>globalThis.document.documentElement).catch(()=>null);
 const url=page.url();const details:Record<string,any>[]=[];
 try {
 for(const [index,c]of checks.entries()){
  if(Date.now()>=deadline){details.push({index,error:'verification_budget'});continue;}
  let handle:any;
  try {
   let actual:unknown,secret=false;
   if(c.type==='url_param'){
    const values=new URL(page.url()).searchParams.getAll(c.name);
    if(values.length>1){details.push({index,type:c.type,error:'ambiguous_url_param'});continue;}
    actual=values.length?values[0]:null;
   }else{
    let target:ActionTarget;
    const resolved=c.target.ref?await referencesFor(page).resolve(c.target.ref):await resolveUnique(page,c.target.locator!,c.target.nth,Math.min(1000,Math.max(1,deadline-Date.now())),c.target.within||c.target.locator?.within);
    if(!('locator' in resolved)){
     if(!c.target.ref&&'suggestions' in resolved){details.push({index,type:c.type,actual:null,expected:c.op==='exists'?true:c.expected,ok:false});continue;}
     details.push({index,type:c.type,error:'reason' in resolved?resolved.reason:'ambiguous_or_hidden'});continue;
    }
    target=resolved.locator;
    if(typeof (target as any).elementHandle==='function'){handle=await (target as any).elementHandle({timeout:Math.min(1000,Math.max(1,deadline-Date.now()))});if(!handle)throw Error('detached');target=targetFor(handle);}
    const read=await target.evaluate((el,args)=>{
      const control=(el.tagName==='LABEL'?(el as HTMLLabelElement).control:el)||el;
      const e=control as HTMLInputElement;
      const secret=e.type==='password'||/^cc-|one-time-code/.test(control.getAttribute('autocomplete')||'');
      let value:unknown;
      if(args.op==='exists')value=true;
      else if(args.read==='checked')value=e.type==='checkbox'||e.type==='radio'?(e.indeterminate?undefined:e.checked):['true','false'].includes(control.getAttribute('aria-checked')||'')?control.getAttribute('aria-checked')==='true':undefined;
      else if(args.read==='selected')value=control.tagName==='OPTION'?(control as HTMLOptionElement).selected:['true','false'].includes(control.getAttribute('aria-selected')||'')?control.getAttribute('aria-selected')==='true':undefined;
      else if(args.read==='value')value=e.value;
      else if(args.read==='attribute')value=control.getAttribute(args.attribute!);
      else value=(el as HTMLElement).innerText;
      return {value,secret};
    },c);
    actual=read.value;secret=read.secret;
   }
   const expected=c.type==='element'&&c.op==='exists'?true:c.expected;
   const normalize=(v:unknown)=>typeof v==='string'?v.replace(/\s+/g,' ').trim():v;
   const ok=c.type==='element'&&c.op==='contains'?typeof actual==='string'&&String(normalize(actual)).includes(String(normalize(expected))):normalize(actual)===normalize(expected);
   if(actual===undefined){details.push({index,type:c.type,error:'unreadable_field'});continue;}
   const display=(v:unknown)=>secret?'[HIDDEN]':typeof v==='string'?redactText(v).slice(0,400):v;
   details.push({index,type:c.type,expected:display(expected),actual:display(actual),ok});
  }catch{details.push({index,type:c.type,error:'read_failed'});}
  finally{if(handle)await handle.dispose().catch(()=>{});}
 }
 const sameDocument=document&&await document.evaluate(el=>el.isConnected).catch(()=>false)&&page.url()===url;
 if(!sameDocument)return {ok:false,execution:'completed',outcome:'UNKNOWN',reason:'document_changed',details,pageState};
 const outcome=details.some(d=>d.ok===false)?'NOT_APPLIED':details.some(d=>d.error)?'UNKNOWN':'APPLIED';
 return {ok:outcome==='APPLIED',execution:'completed',outcome,details,pageState};
 }finally{if(document)await document.dispose().catch(()=>{});}
}
