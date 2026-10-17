// Match the owner-supplied group, never choose a group merely because the bot joined it.
export async function verifyGroupTarget(telegram, me, target) {
  const {result: chat} = await telegram('getChat', {chat_id: target.chatId});
  if (String(chat?.id) !== target.chatId || !['group', 'supergroup'].includes(chat?.type) ||
      chat.title !== target.title || chat.username || chat.active_usernames?.length)
    throw Error('group_identity_mismatch');
  const {result: member} = await telegram('getChatMember', {chat_id: target.chatId, user_id: me.id});
  if (!['member', 'administrator', 'creator'].includes(member?.status) ||
      String(member?.user?.id) !== String(me.id)) throw Error('group_membership_missing');
  if (member.status === 'member' && chat.permissions?.can_send_messages === false)
    throw Error('group_send_forbidden');
}
