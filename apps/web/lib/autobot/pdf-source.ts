import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
export async function pdfSourceText(bytes:Uint8Array,signal:AbortSignal){
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const require=createRequire(process.cwd()+'/package.json');
 pdfjs.GlobalWorkerOptions.workerSrc=pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true});
 const cancel=()=>{void task.destroy();};signal.addEventListener('abort',cancel,{once:true});
 try{signal.throwIfAborted();const doc=await task.promise;const texts:string[]=[];
 for(let n=1;n<=Math.min(doc.numPages,24);n++){signal.throwIfAborted();const page=await doc.getPage(n);const data=await page.getTextContent();texts.push('Страница '+n+': '+data.items.map(x=>'str' in x?x.str:'').join(' '));if(texts.join('').length>60000)break;}
 return texts.join('\n').slice(0,65000);
 }finally{signal.removeEventListener('abort',cancel);await task.destroy();}
}
