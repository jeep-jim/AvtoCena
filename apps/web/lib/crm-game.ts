import crypto from 'node:crypto';
import {mutateDataJson,readDataJson} from './data';
export const GAME_MODES=['hills','battle'] as const;
export type GameMode=typeof GAME_MODES[number];
export type GameResult={runId:string;mode:GameMode;score:number;distance:number;coins:number;kills:number;duration:number;at:string};
export type GamePlayer={id:string;name:string;avatar?:string};
type GameState={profile?:Omit<GamePlayer,'id'>;active?:{id:string;mode:GameMode;startedAt:number};best?:Partial<Record<GameMode,GameResult>>;recent?:GameResult[];lastStart?:number};
const key=(id:string)=>`games/pognali/v1/${encodeURIComponent(id)}.json`;
export const validGameMode=(value:unknown):value is GameMode=>GAME_MODES.includes(value as GameMode);
export function validateGameResult(input:Record<string,unknown>,mode:GameMode,elapsed:number){
 const {distance,coins,kills,duration}=input;
 if(![distance,coins,kills].every(x=>Number.isSafeInteger(x)&&Number(x)>=0)||typeof duration!=='number'||!Number.isFinite(duration)||duration<1||duration>241||duration>elapsed+2)throw Error('invalid_result');
 if(Number(distance)>duration*140+50||Number(coins)>duration*12+20||Number(kills)>8)throw Error('invalid_result');
 if(mode==='hills'&&Number(kills)!==0)throw Error('invalid_result');
 return {distance:Number(distance),coins:Number(coins),kills:Number(kills),duration,score:Math.floor(Number(distance)+Number(coins)*25+(mode==='battle'?Number(kills)*500:0))};
}
export async function beginGame(id:string,mode:GameMode,now=Date.now(),profile?:Omit<GamePlayer,'id'>){
 if(!validGameMode(mode))throw Error('invalid_result');
 const run={id:crypto.randomUUID(),mode,startedAt:now};
 await mutateDataJson<GameState>(key(id),{},current=>{if(current.lastStart&&now-current.lastStart<5000)throw Error('too_many_runs');return {...current,...(profile?{profile}:{}),active:run,lastStart:now};});return run;
}
export async function finishGame(id:string,input:Record<string,unknown>,now=Date.now()){
 let result:GameResult|undefined;
 await mutateDataJson<GameState>(key(id),{},current=>{
  const existing=current.recent?.find(r=>r.runId===input.runId);if(existing){result=existing;return current;}
  const active=current.active;if(!active||active.id!==input.runId||now-active.startedAt>30*60_000)throw Error('run_expired');
  if(!validGameMode(active.mode))throw Error('run_expired');
  result={...validateGameResult(input,active.mode,(now-active.startedAt)/1000),mode:active.mode,runId:active.id,at:new Date(now).toISOString()};
  const best={...current.best};if(!best[active.mode]||result.score>best[active.mode]!.score)best[active.mode]=result;
  return {...current,active:undefined,best,recent:[result,...(current.recent||[])].slice(0,20)};
 });return result!;
}
export async function gameBest(id:string){const best=(await readDataJson<GameState>(key(id),{})).best||{};return Object.fromEntries(GAME_MODES.filter(mode=>best[mode]).map(mode=>[mode,best[mode]])) as Partial<Record<GameMode,GameResult>>;}
export async function gameProfile(id:string){return (await readDataJson<GameState>(key(id),{})).profile;}
export const publicGameId=(id:string)=>crypto.createHash('sha256').update('pognali:'+id).digest('hex');
