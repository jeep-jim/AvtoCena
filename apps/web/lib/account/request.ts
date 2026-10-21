/** Bound decoded request bodies as well as declared Content-Length. */
export async function readAccountJson(request:Request):Promise<Record<string,any>> {
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('Отправьте данные формы ещё раз.');
 const limit=8192;
 if(Number(request.headers.get('content-length'))>limit)throw Error('Слишком большой запрос.');
 const reader=request.body?.getReader();if(!reader)throw Error('Форма не заполнена.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Слишком большой запрос.');}chunks.push(value);}}finally{reader.releaseLock();}
 let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Не удалось прочитать форму.');}
 if(!result||Array.isArray(result)||typeof result!=='object')throw Error('Не удалось прочитать форму.');
 return result;
}

/** Bound multipart bytes even when the client omits Content-Length. */
export async function readAccountUpload(request:Request,limit=3*1024*1024, sizeError='Выберите изображение до 2 МБ.'){
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw Error('Выберите изображение.');
 const reader=request.body?.getReader();if(!reader)throw Error('Выберите изображение.');const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error(sizeError);}chunks.push(value);}}finally{reader.releaseLock();}
 return new Response(new Uint8Array(Buffer.concat(chunks)),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();
}
