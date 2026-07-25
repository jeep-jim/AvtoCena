const DEFAULT_MANAGER_AVATARS = [
  "/avatars/manager-red.webp",
  "/avatars/manager-green.webp",
  "/avatars/manager-yellow.webp",
] as const;

export function defaultManagerAvatar(seed: string | number | undefined | null) {
  const text = String(seed || "manager");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return DEFAULT_MANAGER_AVATARS[Math.abs(hash) % DEFAULT_MANAGER_AVATARS.length];
}

export { DEFAULT_MANAGER_AVATARS };
