// Step 3: download BoolQ and Banking77, pick 50 items each, and pad them with other items from the same dataset.
// Downloads are cached in data/downloads/. No model calls.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parquetReadObjects} from 'hyparquet';
const P=new URL('../data/downloads/',import.meta.url),OUT=new URL('../out/',import.meta.url),seed=2026093006;
const enc=createRequire(import.meta.url)('js-tiktoken').getEncoding('cl100k_base');
const count=s=>enc.encode(s).length,read=p=>readFileSync(new URL(p,P),'utf8');
function random(n){return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(a,rng){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const sources={
 'boolq-validation.parquet':'https://huggingface.co/datasets/google/boolq/resolve/main/data/validation-00000-of-00001.parquet',
 'banking77-test.csv':'https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/test.csv',
 'categories.json':'https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/categories.json'};
mkdirSync(P,{recursive:true});mkdirSync(OUT,{recursive:true});
for(const [file,url] of Object.entries(sources))if(!existsSync(new URL(file,P))){const r=await fetch(url);if(!r.ok)throw Error('Download failed '+r.status);writeFileSync(new URL(file,P),Buffer.from(await r.arrayBuffer()));}
const buffer=readFileSync(new URL('boolq-validation.parquet',P));
const boolq=(await parquetReadObjects({file:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)})).map((r,i)=>({...r,index:i,text:r.passage}));
const bank=JSON.parse(execFileSync('python3',['-c','import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1])))))',new URL('banking77-test.csv',P).pathname],{encoding:'utf8'})).map((r,i)=>({...r,index:i}));
const categories=JSON.parse(read('categories.json'));
const criteria=Object.fromEntries(categories.map(c=>[c,c.replaceAll('_',' ').replaceAll('?','')]));
const rng=random(seed),selected={boolq:shuffle([false,true].flatMap(y=>shuffle(boolq.filter(r=>r.answer===y),rng).slice(0,25)),rng),banking77:shuffle(bank,rng).slice(0,50)};
const top=Number(process.env.REAL_DATA_TOP||20000),rows=[];
for(const [dataset,pool] of [['boolq',boolq],['banking77',bank]]) {
 const targetTexts=new Set(selected[dataset].map(r=>r.text));
 const paddingPool=pool.filter(r=>!targetTexts.has(r.text));
 for(const [i,target] of selected[dataset].entries()) {
  const targetName=dataset==='boolq'?`passage-${i+1}`:`customer-${i+1}`;
  const core=dataset==='boolq'?`Passage ${targetName}:\n${target.text}`:`Customer ${targetName}:\n${target.text}`;
  const question=dataset==='boolq'?`According to passage ${targetName}, ${target.question.replace(/\?$/,'')}?`:`Which intent best describes the message from customer ${targetName}?`;
  const questions={answer:{type:dataset==='boolq'?'noul':'choice',instructions:question,...(dataset==='banking77'?{criteria}:{})}};
  const truth={answer:dataset==='boolq'?target.answer:target.category};
  const filler=shuffle(paddingPool,random(seed+i+(dataset==='boolq'?10000:20000))).map((r,j)=>dataset==='boolq'?`Passage other-${j+1}:\n${r.text}`:`Customer other-${j+1}:\n${r.text}`).join('\n\n');
  const tokens=enc.encode(filler);
  for(const condition of ['compact','8000',String(top)]) {
   let state=core;
   if(condition!=='compact'){
    const size=Number(condition),left=Math.floor((size-count(core)-4)/2);let right=size-count(core)-4-left;
    const build=()=>enc.decode(tokens.slice(0,left))+'\n\n'+core+'\n\n'+enc.decode(tokens.slice(left,left+right));
    for(let k=0;k<8;k++){state=build();const delta=size-count(state);if(delta===0)break;right+=delta;}
   }
   const task_id=`real-${seed}-${dataset}-${i}`;
   rows.push({id:`${task_id}-${condition}`,state,questions,truth,meta:{dataset,condition,task_id,seed,item:i,source_index:target.index,source_split:dataset==='boolq'?'validation':'test',state_tokens:count(state),tokenizer:'cl100k_base'}});
  }
 }
}
writeFileSync(new URL('real.jsonl',OUT),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
writeFileSync(new URL('real-sources.json',OUT),JSON.stringify({seed,sources:Object.entries(sources).map(([file,url])=>({file,url,bytes:readFileSync(new URL(file,P)).length,sha256:createHash('sha256').update(readFileSync(new URL(file,P))).digest('hex')})),selected_indices:Object.fromEntries(Object.entries(selected).map(([k,v])=>[k,v.map(r=>r.index)]))},null,2)+'\n');
console.log(JSON.stringify({requests:rows.length,seed,top}));
