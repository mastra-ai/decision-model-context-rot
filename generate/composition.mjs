import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {random,shuffle,count,decode,row} from './common.mjs';
const require=createRequire(import.meta.url);
const enc=require('js-tiktoken').getEncoding('cl100k_base');
const bank=JSON.parse(readFileSync(new URL('../data/banking-padding.json',import.meta.url)));
const criteria=JSON.parse(readFileSync(new URL('../data/banking77-criteria.json',import.meta.url)));
const people=['Ana','Mina','Lena','Sara','Nora','Tara','Mara','Dina','Rina','Lina'];
export const factors=['plain case','competing entities and near misses','indirect references','updates','retractions and voided updates'];
export function pad(parts,size,seed) {
 const archive=shuffle(bank,random(seed)).slice(0,1400).map((r,j)=>`Archived case H${j}; final status: closed. Customer text: ${r.text}`).join('\n\n');
 const tokens=enc.encode(archive);const budget=size-count(parts.join('\n\n'))-2*parts.length-4;
 const each=Math.floor(budget/(parts.length+1));let tail=budget-each*parts.length;
 const build=()=>parts.map((p,j)=>decode(tokens.slice(j*each,(j+1)*each))+'\n\n'+p+'\n\n').join('')+decode(tokens.slice(parts.length*each,parts.length*each+tail));
 let state=build();for(let k=0;k<6&&count(state)!==size;k++){tail+=size-count(state);state=build();}return state;
}
export function compose(task,level='0-4000',seed=641,n=10) {
 const [difficulty,length]=level.split('-').map(Number),out=[];
 if(difficulty<0||difficulty>4||![4000,16000,30000].includes(length))throw Error('Level must be factor-count 0..4 and length 4000, 16000 or 30000');
 for(let i=0;i<n;i++) {
  const yes=i%2===0, name=people[i%people.length],other=name+' Li',base=seed*100+i;
  let parts=[],question,truth,meta={};
  if(task==='distant-office-v2') {
   const project=`amber-${base}`,workspace=`W${base}`,alt=`W${base+1}B`,team=`Cedar-${base}`,city=yes?'Lisbon':'Porto',wrong=yes?'Porto':'Lisbon';
   question=`Does the person leading project ${project} currently work from Lisbon?`;truth=yes;
   const header='Workspace register. Snapshot: 2026-04-30. An employee works from the city of their assigned workspace. Effective changes replace earlier values. Voiding an event removes its effect. Entries appear in export order.';
   parts=[header,`Project ${project} is led by ${name}.`];
   if(difficulty<2)parts.push(`${name}'s assigned workspace is ${workspace}.`);
   else parts.push(`${name}'s assigned workspace is the workspace managed by team ${team}.`, `Team ${team} manages workspace ${workspace}.`);
   if(difficulty>=1)parts.push(`Project ${project}-review is led by ${other}. ${other}'s assigned workspace is ${alt}. Workspace ${alt} is in ${wrong}.`);
   if(difficulty<3)parts.push(`Workspace ${workspace} is in ${city}.`);
   else {
    parts.push(`Event M${base}: effective 2026-03-10, workspace ${workspace} moved to ${city}.`, `Event N${base}: effective 2026-01-01, workspace ${workspace} was in ${wrong}.`);
    if(difficulty>=4)parts.splice(1,0,`Event V${base}: recorded 2026-04-22, event P${base} is void.`, `Event P${base}: effective 2026-04-15, workspace ${workspace} moved to ${wrong}.`, `Event V${base}B: recorded 2026-04-23, a move of workspace ${alt} is void; it remains in ${wrong}.`);
   }
   meta={truth_city:city,asked_city:'Lisbon',target_name:name,target_workspace:workspace};
  } else if(task==='atm-needle-v2') {
   const a=`C${base}`,b=`C${base}B`,thing=`P${base}`,receipt=`P${base}B`;
   question="Do any open cases report a bank card being retained by a cash machine?";truth=yes;
   parts=['Support-case snapshot: 2026-04-30. Case edits replace earlier status and report text. A void edit has no effect. Archived cases are closed. Case events appear in export order.'];
   const actual=yes?'The cash dispenser would not give my debit card back. I left without it.':'The cash dispenser returned my debit card. It gave me fewer banknotes than I requested.';
   const aliasActual=yes?`The cash dispenser would not return ${thing}. I left without it.`:`The cash dispenser returned ${thing}. It gave me fewer banknotes than I requested.`;
   if(difficulty>=2)parts.push(`Property register: ${thing} is ${name}'s bank card. ${receipt} is ${other}'s paper receipt.`);
   if(difficulty<3)parts.push(`Case ${a}; customer ${name}; status: open. Report: ${difficulty>=2?aliasActual:actual}`);
   else {
    const old=yes?'The missing bank card has been returned.':'The cash dispenser retained my bank card.';
    parts.push(`Edit E${base}: effective 2026-04-12, case ${a}; status: open. Replacement report: ${aliasActual}`,`Edit O${base}: effective 2026-04-01, case ${a}; status: ${yes?'closed':'open'}. Report: ${old}`);
    if(difficulty>=4)parts.splice(1,0,`Edit X${base}: effective 2026-04-18, case ${a}; status: ${yes?'closed':'open'}. Replacement report: ${yes?'The dispenser has returned the bank card.':'The cash machine kept the bank card.'}`,`Audit correction dated 2026-04-21: edit X${base} was posted to the wrong case and is void.`);
   }
   if(difficulty>=1)parts.push(`Case ${b}; customer ${other}; status: closed. Report: The cash machine retained my bank card, but the operator returned it later.`, `Case ${b}2; status: open. Report: The cash machine kept my receipt, but it returned my bank card.`, `Case ${b}3; status: open. Report: I thought the cash machine kept my bank card, but I found it in my bag. It was the cash that was missing.`);
   meta={target_case:a,current_report:actual};
  } else if(task==='banking-lookalikes-v2') {
   const digits=String(9000+i),account=`A${base}`,alias=`T${base}`,different=`A${base}B`;
   const label=yes?'pending_card_payment':'pending_cash_withdrawal',opposite=yes?'pending_cash_withdrawal':'pending_card_payment';
   const reports={pending_card_payment:'I used my debit card to buy groceries. That purchase still appears as waiting to finish in the app.',pending_cash_withdrawal:'I took banknotes from a cash dispenser. That withdrawal still appears as waiting to finish in the app.'};
   question=`Which issue is the customer with the card ending ${digits} currently reporting?`;truth=label;
   parts=['Customer-support export. Snapshot: 2026-04-30. Each ticket has one current reported issue. The latest effective ticket edit replaces its previous issue. Voided edits have no effect. Entries are in export order.'];
   if(difficulty<2)parts.push(`Customer ${name}, card ending ${digits}, owns ticket ${alias}.`);
   else parts.push(`Card register: card ending ${digits} belongs to account ${account}.`, `Account ${account} is held by ${name}.`, `Ticket registry: ${name}'s active ticket is ${alias}.`);
   if(difficulty>=1)parts.push(`Customer ${other}, card ending ${String(8000+i)}, account ${different}, owns ticket ${alias}B. Current issue: ${reports[opposite]}`);
   if(difficulty<3)parts.push(`Ticket ${alias}; current issue: ${reports[label]}`);
   else {
    parts.push(`Ticket edit E${base}: ticket ${alias}, effective 2026-04-12. Replacement issue: ${reports[label]}`,`Ticket edit O${base}: ticket ${alias}, effective 2026-04-01. Issue: ${reports[opposite]}`);
    if(difficulty>=4)parts.splice(1,0,`Ticket edit X${base}: ticket ${alias}, effective 2026-04-20. Replacement issue: ${reports[opposite]}`,`Audit entry 2026-04-22: edit X${base} was attached to the wrong ticket and is void.`);
   }
   meta={target_card_suffix:digits,target_ticket:alias,distractor_label:opposite};
  } else throw Error('Unknown task');
  const state=pad(parts,length,seed+i),r=row(task,seed,i,level,state,question,truth,{...meta,version:2,composition:difficulty,factors:factors.slice(1,difficulty+1),core_parts:parts,target:parts.join('\n\n'),filler_kind:'real Banking77 closed archives'});
  if(task==='atm-needle-v2'&&difficulty>=2){r.id+='-explicit';r.meta.level+='-explicit';r.meta.change='Dispenser explicitly identified as a cash dispenser; previous wording ambiguous.';}
  if(task==='banking-lookalikes-v2')r.questions.answer={type:'choice',instructions:question,criteria};out.push(r);
 }
 return out;
}
