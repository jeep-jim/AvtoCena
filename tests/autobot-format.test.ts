import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
const require=createRequire(import.meta.url);
test('actual answer renderer produces headings, emphasis and lists while escaping HTML and unsafe links',async()=>{
 const output=await build({entryPoints:['apps/web/components/autobot/AutobotText.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
 const module={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
 const html=renderToStaticMarkup(createElement(module.exports.AutobotText,{text:'### ⚡ Мощность\n\n**60 кВт**\n\n- Первый вариант\n- Второй вариант\n\n<script>alert(1)</script>\n[опасно](javascript:alert)\n[источник](https://example.com)'}));
 assert.match(html,/<h3>/);assert.match(html,/<strong>60 кВт<\/strong>/);assert.match(html,/<ul><li>/);
 assert.doesNotMatch(html,/<script|href="javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/rel="noopener noreferrer"/);
});
