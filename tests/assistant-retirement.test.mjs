import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read=p=>fs.readFileSync(p,'utf8');
test('retired assistant stays unmounted while Autobot remains available',()=>{
 const layout=read('apps/web/app/layout.tsx');
 assert.doesNotMatch(layout, /TeamAssistant/);
 assert.match(layout, /<Autobot\s*\/>/);
 assert.doesNotMatch(read('apps/web/components/crm/CrmShellView.tsx'), /<TeamAssistant|Открыть ИИ-помощника/);
 assert.match(read('apps/web/app/assistant-connect/page.tsx'), /notFound\(\)/);
 const permissions=read('apps/web/components/crm/StaffPermissions.tsx');
 assert.match(permissions, /filter\(key=>key!=='assistant'\)/);
 assert.match(permissions, /assistantPageControl/);
 assert.match(permissions, /assistantCode/);
});
