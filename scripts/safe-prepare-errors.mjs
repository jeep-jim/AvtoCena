import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const definitions=JSON.parse(readFileSync(new URL('../static-errors.json',import.meta.url),'utf8'));
const sha=v=>createHash('sha256').update(v).digest('hex');
const classes=['TypeError','SyntaxError','AssertionError','RangeError','StorageConflictError','Error'];
export function explain(error){
 const text=[error?.message,error?.stderr].filter(x=>x!==undefined).map(String).join('\n');
 const matches=definitions.filter(d=>text.includes(d.text)).map(d=>d.id);
 const storage=[...text.matchAll(/\bobject_storage_(GET|HEAD|PUT|DELETE|read|write|metadata|head|list)_(unreachable|[1-5]\d\d)\b/g)].map(m=>({method:m[1],status:m[2]}));
 const signatures={invalidJson:/Unexpected (?:token|end)|not valid JSON|JSON at position/.test(text),fetchFailed:/fetch failed/.test(text),assertion:/AssertionError|Expected values to be/.test(text),timeout:/timed? ?out|timeout|AbortError/i.test(text),heap:/heap out of memory|Reached heap limit/.test(text),unexpectedWrite:/\bunexpected_write(?::|\b)/.test(text),nullPropertyRead:/Cannot read properties of (?:undefined|null)/.test(text),stackOverflow:/Maximum call stack size exceeded/.test(text),invalidStringLength:/Invalid string length/.test(text),missingModule:/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/.test(text),diskFull:/\bENOSPC\b/.test(text),connectionReset:/\bECONNRESET\b/.test(text),permissionDenied:/\b(?:EACCES|EPERM)\b/.test(text)};
 const lines=String(error?.stderr??error?.message??'').split('\n').filter(x=>x.length).slice(0,20).map(line=>({bytes:Buffer.byteLength(line),sha256:sha(line),shape:/^\s*at /.test(line)?'stack':/^[A-Za-z][A-Za-z0-9_]*(?::|$)/.test(line)?'code-or-prefix':/^\s*[\[{]/.test(line)?'structured':'text'}));
 return {class:classes.includes(error?.name)?error.name:'Other',staticCodes:[...new Set(matches)].slice(0,24),storage:storage.slice(0,8),signatures,lines,
  messageBytes:Buffer.byteLength(String(error?.message||'')),stderrBytes:Buffer.byteLength(String(error?.stderr||'')),
  exitCode:Number.isInteger(error?.code)?error.code:null,signal:['SIGABRT','SIGKILL','SIGTERM','SIGSEGV'].includes(error?.signal)?error.signal:null,killed:error?.killed===true,
  processCode:['ENOBUFS','ERR_CHILD_PROCESS_STDIO_MAXBUFFER','ETIMEDOUT','ENOMEM','ECONNRESET','ENOENT'].includes(error?.code)?error.code:null};
}
