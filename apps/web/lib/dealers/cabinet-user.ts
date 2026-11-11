import {redirect} from 'next/navigation';
import {getCurrentUser} from '../auth';
import {canManageDealer} from './access';
export async function cabinetUser(){
 const user=await getCurrentUser();
 if(!user)redirect('/login?next=/dealer-cabinet/overview');
 if(!user.companyId||!await canManageDealer(user,user.companyId))redirect('/dealer-cabinet');
 return user;
}
