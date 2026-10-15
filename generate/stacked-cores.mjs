// Step 1: build the stacked office (T1) and stacked banking (T2) fact chains, unpadded.
import {compose,pad} from './composition.mjs';
import {count,save} from './common.mjs';
const level='core',n='50';
for(const family of ['distant-office','banking-lookalikes']){
 const items=compose(family+'-v2','4-4000',697,Number(n));
 for(const r of items){
  const m=r.meta,b=69700+m.item,parts=[...m.core_parts];
  if(family==='distant-office'){
   const direct=parts.findIndex(p=>p.startsWith('Project amber-')&&p.includes(' is led by '));
   parts[direct]=`Project amber-${b} is led by employee E${b}. Employee E${b} uses the display name ${m.target_name}.`;
   const mapping=parts.findIndex(p=>p.startsWith(`Team Cedar-${b} manages workspace`));
   parts[mapping]=`Team Cedar-${b} manages the workspace assigned to portfolio F${b}. Assignment A${b}: effective 2026-04-10, portfolio F${b} uses workspace ${m.target_workspace}. Assignment B${b}: effective 2026-04-20, portfolio F${b} uses workspace W${b+1}B. Assignment C${b}: effective 2026-04-25, assignment B${b} is void.`;
   parts.splice(2,0,`A draft roster proposes replacing employee E${b} with ${m.target_name} Li as project lead. This draft has not been approved and has no effect on the current register.`);
  }else{
   const mapping=parts.findIndex(p=>p.startsWith('Card register:'));
   parts[mapping]=`Card register: card ending ${m.target_card_suffix} is linked to wallet Q${b}. Link L${b}: effective 2026-04-10, wallet Q${b} belongs to account A${b}. Link M${b}: effective 2026-04-20, wallet Q${b} belongs to account A${b}B. Link N${b}: effective 2026-04-25, link M${b} is void.`;
   parts.splice(2,0,`Draft ticket merge: ${m.target_ticket} would be merged into ${m.target_ticket}B. The merge has not been approved and has no effect on the current ticket registry.`);
  }
  r.id=`stacked-${family}-dev-697-${m.item}-${level}`;r.state=level==='core'?parts.join('\n\n'):pad(parts,Number(level),697+m.item);
  r.meta={...m,task:`stacked-${family}`,level,is_control:level==='core',core_parts:parts,target:parts.join('\n\n'),state_tokens:count(r.state),change:'Add alias/portfolio links, dated and voided assignments, and explicitly inactive draft changes'};
  if(count(r.state)+count(JSON.stringify(r.questions))>=32000)throw Error('Window limit');
 }
 save(new URL(`../out/stacked-${family}-core.jsonl`,import.meta.url),items);
}
