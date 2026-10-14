import type { Page } from 'playwright';
import type { PageStateInfo } from './page-state';
import { inspectPageState } from './page-state';

export interface PopupEffect { sessionId?: string; url: string; title: string; setupStatus: 'ready'|'partial'; pageState?: PageStateInfo; setupError?: string }
const registrars = new WeakMap<Page,(popup:Page)=>Promise<PopupEffect>>();
export function registerPopupHandler(page:Page,handler:(popup:Page)=>Promise<PopupEffect>): void { registrars.set(page,handler); }
export function watchPopups(page:Page) {
 const pending:Promise<PopupEffect>[]=[];
 let notify:()=>void=()=>{};
 const first=new Promise<void>(resolve=>{notify=resolve;});
 const listener=(popup:Page)=>{
  pending.push((async()=>{
   const handler=registrars.get(page);
   const registered=handler ? await handler(popup) : {url:popup.url(),title:'',setupStatus:'partial' as const,setupError:'No session registrar'};
   await popup.waitForLoadState('domcontentloaded',{timeout:1500}).catch(()=>{});
   return {...registered,url:popup.url(),title:await popup.title().catch(()=>''),pageState:await inspectPageState(popup)};
  })().catch(()=>({url:popup.url(),title:'',setupStatus:'partial' as const,setupError:'Popup preparation failed'})));
  notify();
 };
 page.on('popup',listener);
 return { stop:()=>page.off('popup',listener), async finish(expected:boolean):Promise<PopupEffect[]> {
  if(expected&&!pending.length){let timer:ReturnType<typeof setTimeout>;await Promise.race([first,new Promise<void>(r=>{timer=setTimeout(r,3000);})]);clearTimeout(timer!);}
  return Promise.all(pending);
 }};
}
