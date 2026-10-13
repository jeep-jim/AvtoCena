'use client';
export function AssistantLauncher(){return <button type="button" className="team-assistant-launch" onClick={()=>window.dispatchEvent(new Event('team-assistant-open'))}>Чат с ИИ-помощником <span aria-hidden="true">↗</span></button>;}
