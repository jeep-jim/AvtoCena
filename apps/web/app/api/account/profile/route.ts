import {currentAccount,accountPath,publicAccount,accountRateLimit,type CustomerAccount} from '@/lib/account/auth';
import {readAccountJson} from '@/lib/account/request';
import {validCustomerAvatar} from '@/lib/account/avatars';
import {customerNameError} from '@/lib/account/profile-name';
import {mutateDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});const a=await currentAccount();if(!a)return new Response(null,{status:401});try{
 if(!await accountRateLimit('profile:'+a.id,30,300000))return new Response(null,{status:429});const b=await readAccountJson(request);const name=b.name;const nameError=customerNameError(name);if(nameError)throw Error(nameError);if(!validCustomerAvatar(b.avatarId))throw Error('Выберите аватар.');
 let result=a;await mutateDataJson<CustomerAccount|null>(accountPath(a.id),null,current=>{if(!current||current.disabled)throw Error('Нет доступа.');result={...current,name,profileConfigured:true,avatarId:b.avatarId,...(b.usePreset===true?{avatarVersion:undefined}:{})};return result;});return Response.json({account:publicAccount(result)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить профиль.'},{status:400});}}
