import {createRequire} from 'node:module';
import {writeFileSync, mkdirSync} from 'node:fs';
const require = createRequire(import.meta.url);
export const tokenizer = 'js-tiktoken@1.0.21/cl100k_base';
const enc = require('js-tiktoken').getEncoding('cl100k_base');
export const count = s => enc.encode(s).length;
export function random(seed) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(xs, rng) {
  const a = [...xs]; for (let i=a.length-1;i>0;i--) {const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a;
}
const sentences = [
 'The wind moves over the grass and the trees beside the river.',
 'The gardener put the empty pots on a wooden shelf.',
 'A narrow path runs between the pond and the old stone wall.',
 'The blue cup sits beside a clean plate on the table.',
 'Rain left small pools of water on the garden path.',
 'The curtains were drawn before the lights were switched on.',
 'A paper bag contains a loaf of bread and a small cake.',
 'The old clock hangs above the fireplace in the quiet room.',
 'Dry leaves cover the ground beneath the trees.',
 'The blanket was folded and placed at the foot of the bed.',
 'A grey bird landed on the fence and then flew away.',
 'The wooden box holds spare buttons and a piece of string.'
];
export function padding(seed) {
 const rng=random(seed); let s=''; for(let i=0;i<3000;i++) s+=sentences[Math.floor(rng()*sentences.length)]+'\n'; return enc.encode(s);
}
export const decode = tokens => enc.decode(tokens);
export function row(task, seed, i, level, state, question, truth, extra={}) {
 return {id:`${task}-dev-${seed}-${i}-${level}`, state, questions:{answer:{type:'noul',instructions:question}}, truth:{answer:truth}, meta:{task,split:'dev',seed,item:i,level,tokenizer,state_tokens:count(state),question_tokens:count(question),...extra}};
}
export function save(path, rows) {mkdirSync(new URL('.', path),{recursive:true});writeFileSync(path,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');}
