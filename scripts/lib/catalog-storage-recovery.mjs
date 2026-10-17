import {catalogStorageBudget} from './catalog-storage-budget.mjs';
export function storageBlockedInputBytes(log){
 if(!String(log).includes('Object Storage reserve insufficient'))return null;
 const matches=[...String(log).matchAll(/\{[^\n]*"inputBytes":(\d+)[^\n]*"ok":false[^\n]*\}/g)];
 const value=Number(matches.at(-1)?.[1]);return Number.isSafeInteger(value)&&value>=0?value:null;
}
export function storagePressureRecovery({currentBytes,inputBytes,cleanupRunning,recovery,now=Date.now()}){
 if(catalogStorageBudget(currentBytes,inputBytes).ok)return {action:'retry',reason:'storage_reserve_available'};
 if(cleanupRunning)return {action:'wait',reason:'storage_cleanup_running'};
 if(now-Date.parse(recovery?.storageCleanupRequestedAt||'')<2*3600000)return {action:'wait',reason:'storage_cleanup_cooldown'};
 const active=now-Date.parse(recovery?.storageWindowStartedAt||'')<86400000;
 const attempts=active?Number(recovery.storageCleanupAttempts||0):0;
 if(attempts>=3)return {action:'wait',reason:'storage_pressure_requires_attention'};
 return {action:'cleanup',reason:'storage_reserve_insufficient',storageCleanupAttempts:attempts+1,storageWindowStartedAt:active?recovery.storageWindowStartedAt:new Date(now).toISOString(),storageCleanupRequestedAt:new Date(now).toISOString()};
}
