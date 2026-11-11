import {CrmPageHeading} from '@/components/crm/CrmWorkspaceFrame';
import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {StaffAvatarUpload} from '@/components/crm/StaffAvatarUpload';
import {defaultManagerAvatar} from '@/lib/default-avatars';
import {DealerPersonalProfile} from '@/components/dealers/DealerPersonalProfile';
export const dynamic='force-dynamic';
export default async function Page(){const user=await cabinetUser();return <section className="dealer-cabinet-content"><CrmPageHeading title="Мой профиль"/><StaffAvatarUpload userId={user.id} avatar={user.avatarUrl||defaultManagerAvatar(user.id)} endpoint="/api/dealers/profile/avatar"/><DealerPersonalProfile name={user.displayName} phone={user.personalPhone||''}/><p className="mt-5 text-sm">Логин: {user.telegramUsername}</p></section>;}
