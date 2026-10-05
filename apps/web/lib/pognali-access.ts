import {currentAccount} from '@/lib/account/auth';
import {customerAvatar} from '@/lib/account/avatars';
import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {readCrmUsers} from '@/lib/crm-users';
import {getJsonStorage} from '@/lib/data';
import {gameBest,gameProfile,publicGameId,type GamePlayer,type GameResult,type GameMode} from '@/lib/crm-game';
export async function currentGameAccess():Promise<{player:GamePlayer|null;status:200|401|403}>{
 const account=await currentAccount();
 if(account)return {status:200,player:{id:'customer:'+account.id,name:account.profileConfigured?account.name:'Игрок',avatar:customerAvatar(account.id,account.avatarId)}};
 const user=await getCurrentUser();
 if(!user||!isCrmRole(user.role)||user.status==='disabled')return {player:null,status:401};
 if(!hasCrmPermission(user,'game'))return {player:null,status:403};
 return {status:200,player:{id:user.id,name:user.displayName,avatar:user.avatarUrl}};
}
export async function globalGameRanking(){
 const storage=getJsonStorage();if(!storage.listObjects)throw Error('ranking_unavailable');
 const [objects,staff]=await Promise.all([storage.listObjects('games/pognali/v1/'),readCrmUsers()]);
 const names=new Map(staff.map(u=>[u.id,{name:u.displayName,avatar:u.avatarUrl}]));
 const ids=[...new Set(objects.filter(o=>o.key.startsWith('games/pognali/v1/')&&o.key.endsWith('.json')).map(o=>decodeURIComponent(o.key.slice('games/pognali/v1/'.length,-5))))];
 const rows:{id:string;name:string;avatar?:string;best:Partial<Record<GameMode,GameResult>>}[]=[];
 for(let i=0;i<ids.length;i+=8){const batch=await Promise.all(ids.slice(i,i+8).map(async id=>{
  const [best,profile]=await Promise.all([gameBest(id),gameProfile(id)]);
  // Existing staff records retain their historical results across companies.
  const player=profile||names.get(id);if(!player||!Object.keys(best).length)return null;
  return {id:publicGameId(id),name:player.name,avatar:player.avatar,best};
 }));for(const row of batch)if(row)rows.push(row);}
 return rows;
}
