import {offerCopySetting} from "@/lib/offer-copy";
import {parseWorkAddresses} from "@/lib/staff-workplaces";
import {normalizeStaffPhone} from "@/lib/staff-phone";
import {saveStaffBirthDate,validateBirthDate} from "@/lib/crm-team";
import {isCalculationOriginAllowed} from "@/lib/catalog/calculation-request-origin";
import {CRM_PERMISSIONS,isAdministrativeCrmPermission,hasCrmPermission,type CrmPermission,type CrmPermissions} from "@/lib/crm-permissions";
import {recordCrmActivity,activityChanges,activityPerson} from "@/lib/crm-activity";
import { NextResponse } from "next/server";
import { getAuthUsers, getCurrentUser, isAdminRole, normalizeTelegramUsername, type AuthUser, type UserRole } from "@/lib/auth";
import { generateId, mutateDataJson } from "@/lib/data";
import { staffIdentityChanged, staffRedirect } from "@/lib/crm-staff-save";

function clean(value: FormDataEntryValue | null, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function redirectWithState(request: Request, path: string, state: "saved" | "error", message = "") {
  const url = new URL(path, request.url);
  url.searchParams.set("state", state);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return staffRedirect(url.pathname + url.search);
}

export async function POST(request: Request) {
  if(!isCalculationOriginAllowed(request))return Response.json({error:"origin_forbidden"},{status:403});
  const actor = await getCurrentUser();
  if (!actor || !hasCrmPermission(actor,"staff")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/crm/managers");
    login.searchParams.set("error", "auth_required");
    return staffRedirect(login.pathname + login.search);
  }

  let returnPath = "/crm/managers";
  try {
    const form = await request.formData();
    const userId = clean(form.get("userId"), 120);
    const offerCopyEnabled = offerCopySetting(actor, form);
    const phoneInput=clean(form.get("personalPhone"),40);
    const personalPhone=form.has("personalPhone")?normalizeStaffPhone(phoneInput):undefined;
    const displayName = clean(form.get("displayName"), 160);
    const telegramUsername = normalizeTelegramUsername(clean(form.get("telegramUsername"), 160));
    const requestedRole = clean(form.get("role"), 40) as UserRole;
    const role: UserRole = ["owner", "admin", "manager", "dealer"].includes(requestedRole) ? requestedRole : "manager";
    const permissions:CrmPermissions|undefined=form.get("permissionsPresent")==="1"?Object.fromEntries((Object.keys(CRM_PERMISSIONS) as CrmPermission[]).map(key=>[key,role==="owner"?true:role==="manager"&&isAdministrativeCrmPermission(key)?false:form.get(`permission_${key}`)==="on"])):undefined;
    if(permissions&&actor.role!=="owner"&&Object.entries(permissions).some(([key,value])=>value&&!hasCrmPermission(actor,key as CrmPermission)))throw Error("Нельзя выдать права, которых у вас нет");
    if(actor.role!=="owner"&&form.has("permission_deleteReviews"))throw Error("Право удаления отзывов выдаёт только владелец");
    if(actor.role!=="owner"&&permissions)delete permissions.deleteReviews;
    const birthDate=form.has("birthDate")?validateBirthDate(clean(form.get("birthDate"),10)):undefined;
    const status = clean(form.get("status"), 30) === "disabled" ? "disabled" : "active";
    const companyId = clean(form.get("companyId"), 160) || "dealer_topavto";
    returnPath = userId ? `/crm/managers/${encodeURIComponent(userId)}` : "/crm/managers/new";
    const workplaces=form.get("workplacesPresent")==="1"?{workAddresses:parseWorkAddresses(String(form.get("workAddresses")||"[]")),remoteWork:form.get("remoteWork")==="on"}:undefined;

    if (phoneInput&&!personalPhone) throw new Error("Проверьте личный телефон: укажите номер с кодом страны, например +7 999 123-45-67");
    if (!displayName || !telegramUsername) throw new Error("Укажите имя и Telegram username");
    if (role === "owner" && actor.role !== "owner") throw new Error("Назначить владельца может только владелец");

    const assertCanGrant=(candidate:AuthUser)=>{if(actor.role!=="owner"&&(Object.keys(CRM_PERMISSIONS) as CrmPermission[]).some(key=>hasCrmPermission(candidate,key)&&!hasCrmPermission(actor,key)))throw Error("Нельзя выдать права, которых у вас нет");};
    const seed = getAuthUsers();
    let savedId = userId;
    let previous:any;
    await mutateDataJson<AuthUser[]>("auth/users.json", seed, (stored) => {
      const users = Array.isArray(stored) && stored.length ? stored : seed;
      const duplicate = users.find((item) => normalizeTelegramUsername(item.telegramUsername) === telegramUsername && item.id !== userId);
      if (duplicate) throw new Error("Этот Telegram username уже добавлен");

      if (!userId) {
        savedId = generateId("user");
        const candidate:AuthUser={ id: savedId, displayName, telegramUsername, role, status, companyId, personalPhone, permissions, offerCopyEnabled: offerCopyEnabled ?? false, ...workplaces, updatedAt: new Date().toISOString() };
        assertCanGrant({...candidate,status:"active"});
        return [candidate, ...users];
      }

      const current = users.find((item) => item.id === userId);
      if (!current) throw new Error("Сотрудник не найден");
      if (current.role === "owner" && actor.role !== "owner") throw new Error("Изменить владельца может только владелец");
      if (actor.id === userId && (status === "disabled" || role !== current.role)) throw new Error("Нельзя отключить или понизить собственный доступ");
      if(actor.role!=="owner"&&permissions)permissions.deleteReviews=current.permissions?.deleteReviews===true;
      assertCanGrant({...current,role,status:"active",permissions:permissions||current.permissions});
      previous=current;
      if(actor.id===userId&&permissions&&!permissions.staff)throw Error("Нельзя отключить собственное управление доступом");
      const identityChanged = staffIdentityChanged(current.telegramUsername, telegramUsername);
      return users.map((item) => item.id === userId ? { ...item, displayName, telegramUsername, role, status, companyId, ...workplaces, ...(personalPhone!==undefined?{personalPhone}:{}), ...(permissions?{permissions}:{}), ...((current.companyId!==companyId||current.role!==role)?{dealerApproved:false}:{}), ...(offerCopyEnabled!==undefined?{offerCopyEnabled}:{}),
        sessionVersion: (item.sessionVersion || 0) + (identityChanged || item.role !== role || item.status !== status || (permissions&&JSON.stringify(item.permissions)!==JSON.stringify(permissions)) ? 1 : 0),
        ...(identityChanged ? {telegramId:"",botBindHash:"",botBindExpiresAt:""} : {}),
        updatedAt: new Date().toISOString() } : item);
    });

    if(birthDate!==undefined)await saveStaffBirthDate(savedId,birthDate);
    await recordCrmActivity(actor,{type:userId?"staff_updated":"staff_created",title:userId?"Изменён сотрудник":"Добавлен сотрудник",visibility:"management",entityType:"staff",entityId:savedId,entityLabel:displayName,target:{id:savedId,name:displayName},href:`/crm/managers/${encodeURIComponent(savedId)}`,changes:activityChanges(previous||{},{displayName,telegramUsername,role,status,...(personalPhone!==undefined?{personalPhone}:{})},{personalPhone:"Личный телефон",displayName:"Имя",telegramUsername:"Логин",role:"Роль",status:"Доступ"}).concat(workplaces?activityChanges({workAddresses:previous?.workAddresses?.join("; ")||"",remoteWork:previous?.remoteWork?"Да":"Нет"},{workAddresses:workplaces.workAddresses.join("; "),remoteWork:workplaces.remoteWork?"Да":"Нет"},{workAddresses:"Место работы",remoteWork:"Удалённая работа"}):[]).concat(permissions?Object.entries(permissions).filter(([k,v])=>v!==hasCrmPermission(previous||({role:"manager"} as AuthUser),k as CrmPermission)).map(([k,v])=>({label:CRM_PERMISSIONS[k as CrmPermission].label,after:v?"Разрешено":"Запрещено"})):[]).concat(offerCopyEnabled!==undefined && offerCopyEnabled!==(previous ? previous.offerCopyEnabled!==false : false) ? [{label:"Ромашка — копирование авто",after:offerCopyEnabled?"Включено":"Выключено"}] : [])});
    return redirectWithState(request, `/crm/managers/${encodeURIComponent(savedId)}`, "saved");
  } catch (error) {
    console.error("crm_user_save_failed", error);
    return redirectWithState(request, returnPath, "error", error instanceof Error ? error.message : "Не удалось сохранить сотрудника");
  }
}
