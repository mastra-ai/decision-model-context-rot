// Step 2: write the six generated task sets at every padding length. No model calls.
// Needs out/stacked-*-core.jsonl from step 1 and the frozen pools in data/.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const DATA=new URL('../data/',import.meta.url),OUT=new URL('../out/',import.meta.url);
const enc=createRequire(import.meta.url)('js-tiktoken').getEncoding('cl100k_base');
const count=s=>enc.encode(s).length,seed=93017,n=50;
function random(seed){let n=seed>>>0;return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(xs,rng){const a=[...xs];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const read=p=>JSON.parse(readFileSync(new URL(p,DATA),'utf8'));
const bank=read('padding.json'),facts=read('capitals.json'),cardSuffixes=read('card-suffixes.json');
if(facts.length<100)throw Error(`Need 100 disjoint capital tuples; have ${facts.length}`);
const criteria=read('banking77-criteria.json');
const first=['Aveline','Branwen','Cerys','Delphine','Elowen','Fenna','Ginevra','Honora','Isolde','Jessamine'];
const surnames=['Kestward','Veltrane','Mornwick','Arleston','Bexford','Corliss','Dunmere','Eldwyck','Fairholt','Glenvar'];
// Top lengths are the longest inputs Jev accepted: 26k for T1 and T2, 20k for T3, 22k for T4 and T5. T6 has one 16k length.
const taskLevels={T1:['compact','4000','16000','26000'],T2:['compact','26000'],T3:['compact','20000'],T4:['compact','4000','16000','22000'],T5:['compact','22000'],T6:['compact','16000']};
const old={};for(const [t,name] of [['T1','distant-office'],['T2','banking-lookalikes']])old[t]=readFileSync(new URL(`stacked-${name}-core.jsonl`,OUT),'utf8').trim().split('\n').map(JSON.parse);
function filler(task,i){
 if(['T1','T2','T6'].includes(task))return shuffle(bank,random(seed+i)).slice(0,1400).map((r,j)=>`Archived case HX${930170+i}-${j}; final status: closed. Customer text: ${r.text}`).join('\n\n');
 if(task==='T3')return Array.from({length:2400},(_,j)=>`{"trace":"diag-${930170+i}-${j}","component":"cache-worker","result":"unchanged","elapsed_ms":${(j*37+i)%997},"shard":${j%13}}`).join('\n');
 const sentences=[`The amber bowl rests underneath a linen cover.`,`A caretaker arranged new pebbles along the greenhouse wall.`,`Three unpainted stools stood beside the empty orchard gate.`,`A folded map remained inside the brass-handled drawer.`,`The awning cast a diagonal shadow across the courtyard tiles.`];
 const rng=random(seed+i);return Array.from({length:3000},(_,j)=>`Note FX${930170+i}-${j}: ${sentences[Math.floor(rng()*sentences.length)]}`).join('\n');
}
function padded(parts,size,text,task){
 const tokens=enc.encode(text),core=parts.join('\n\n');let state;
 if(task==='T3')parts=[core];
 let budget=size-count(core)-2*parts.length-10;
 const each=task==='T3'?budget:Math.floor(budget/(parts.length+1));let tail=task==='T3'?0:budget-each*parts.length;
 const build=()=>parts.map((p,j)=>enc.decode(tokens.slice(j*each,(j+1)*each))+'\n\n'+p+'\n\n').join('')+enc.decode(tokens.slice(parts.length*each,parts.length*each+tail));
 state=build();for(let k=0;k<8&&count(state)!==size;k++){if(task==='T3'){// Preserve full table, adjust diagnostics only.
   const cut=Math.max(0,size-count(core)-4);state=enc.decode(tokens.slice(0,cut))+'\n\n'+core;break;
  }tail+=size-count(state);state=build();}
 if(count(state)>size+5)throw Error('Padding overshoot');return state;
}
const all=[],entities=new Set(),content=[];
function addEntities(xs){for(const x of xs)entities.add(x);}
for(const task of Object.keys(taskLevels)){
 const rowsByLevel=Object.fromEntries(taskLevels[task].map(l=>[l,[]]));
 for(let i=0;i<n;i++){
  const yes=i%2===0,b=9301700+({T1:0,T2:1000,T3:2000,T4:3000,T5:4000,T6:5000}[task])+i,name=first[i%10]+' '+surnames[Math.floor(i/10)];
  let parts,questions,truth=yes,extra={};
  if(task==='T1'||task==='T2'){
   const r=old[task][i],oldName=['Ana','Mina','Lena','Sara','Nora','Tara','Mara','Dina','Rina','Lina'][i%10];
   const replace=s=>s.replaceAll(String(69700+i+1)+'B',String(b+1)+'B').replaceAll(String(69700+i),String(b)).replace(new RegExp(`\\b${oldName}\\b`,'g'),name).replaceAll(String(9000+i),cardSuffixes[i]).replaceAll(String(8000+i),cardSuffixes[100+i]);
   parts=r.meta.core_parts.map(replace);questions=JSON.parse(replace(JSON.stringify(r.questions)));truth=r.truth.answer;
   addEntities([name,name+' Li',...parts.join(' ').matchAll(/\b(?:[A-Z]|amber-|Cedar-)\d+[A-Z]?\b/g)].map(x=>Array.isArray(x)?x[0]:x));
   if(task==='T2'){addEntities([cardSuffixes[i],cardSuffixes[100+i]]);extra.card_suffix=cardSuffixes[i];}
  }else if(task==='T3'){
   const rng=random(seed+i),actual=yes?301:299,ids=shuffle(Array.from({length:900},(_,j)=>j),rng);
   const lines=shuffle(Array.from({length:900},(_,j)=>`Z${i}-${ids[j]} | ${j<actual?'open':['closed','open','open'][j%3]} | ${j<actual?'card payment':['card payment','cash withdrawal','card payment'][j%3]} | ${j<actual?'12:01':['12:01','12:01','11:59'][j%3]}`),rng);
   parts=['Support queue snapshot. One row per ticket; no duplicate IDs or updates. All receipt times are on 2026-04-30 in UTC. Columns: ticket ID | current status | subject | received time.\n'+lines.join('\n')];
   questions={answer:{type:'noul',instructions:'Are there more than 300 open tickets about card payments received after 12:00 UTC on 2026-04-30?'}};
   extra.matching_count=actual;addEntities(lines.map(l=>l.split(' | ')[0]));
  }else if(task==='T4'){
   const [country,real,stated]=facts[i],passage=`capital-${seed}-${i}`;
   parts=[`Passage ${passage}:\nThe capital of ${country} is ${stated}.`];
   questions={answer:{type:'noul',instructions:`According to passage ${passage}, is ${yes?stated:real} the capital of ${country}?`}};
   extra={country,real_capital:real,stated_capital:stated};addEntities([country,real,stated,passage]);
  }else if(task==='T5'){
   const other=first[(i+1)%10]+' '+surnames[Math.floor(i/10)],office=`Orlo${b}`,alt=`Vela${b}`,city='Tampere',wrong='Dunedin';
   parts=[`Employee directory:\n${name}'s assigned office is ${office}.\n${other}'s assigned office is ${alt}.`,`Office directory:\nThe ${alt} office is in ${wrong}.\nThe ${office} office is in ${city}.`];
   questions={answer:{type:'noul',instructions:`Is ${name}'s assigned office in ${yes?city:wrong}?`}};addEntities([name,other,office,alt,city,wrong]);
  }else{
   parts=['Support-case snapshot: 2026-04-30. Case edits replace earlier status and report text. A void edit has no effect. Archived cases are closed. Case events appear in export order.',`Case C${b}; customer ${name}; status: open. Report: ${yes?'The cash dispenser would not give my debit card back. I left without it.':'The cash dispenser returned my debit card. It gave me fewer banknotes than I requested.'}`];
   questions={answer:{type:'noul',instructions:'Do any open cases report a bank card being retained by a cash machine?'}};addEntities([`C${b}`,name]);
  }
  const core=parts.join('\n\n'),background=filler(task,i);content.push({task,item:i,core,parts});
  for(const level of taskLevels[task]){
   const state=level==='compact'?core:padded(parts,Number(level),background,task),tokens=count(state);
   if(tokens+count(JSON.stringify(questions))>=32000)throw Error('Proxy window');
   const r={id:`test-${task}-${seed}-${i}-${level}`,state,questions,truth:{answer:truth},meta:{task,split:'test',seed,item:i,level,arm:'stated',base_id:`${task}-${seed}-${i}`,tokenizer:'js-tiktoken@1.0.21/cl100k_base',state_tokens:tokens,core_parts:parts,...extra}};
   rowsByLevel[level].push(r);all.push(r);
  }
 }
 mkdirSync(new URL('tasks/',OUT),{recursive:true});
 for(const [level,rows] of Object.entries(rowsByLevel))writeFileSync(new URL(`tasks/${task}-${level}.jsonl`,OUT),rows.map(JSON.stringify).join('\n')+'\n');
 console.log(`Prepared ${task}: ${taskLevels[task].join(', ')}`);
}
