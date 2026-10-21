import sharp, {type Sharp} from 'sharp';
export const MAX_AVATAR_BYTES=5*1024*1024;
export async function normalizeStaffAvatar(input:Buffer){
 if(!input.length||input.length>MAX_AVATAR_BYTES)throw Error('Размер фотографии должен быть не больше 5 МБ.');
 let source:Sharp;
 const brands=input.subarray(8,40).toString('ascii');
 if(input.subarray(4,8).toString()==='ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(brands) && !/avif|avis/.test(brands)){
   const decode=(await import('heic-decode')).default;
   const images=await decode.all({buffer:input});
   try {
     const image=images[0];
     if(!image || image.width*image.height>60_000_000)throw Error('Слишком большое разрешение фотографии.');
     const raw=await image.decode();
     source=sharp(Buffer.from(raw.data),{raw:{width:raw.width,height:raw.height,channels:4}});
   }finally{images.dispose();}
 }else{
   source=sharp(input,{limitInputPixels:60_000_000,animated:false});
   const metadata=await source.metadata();
   if(!['jpeg','png','webp','gif','avif','heif','tiff'].includes(metadata.format||''))throw Error('Выберите фотографию JPEG, PNG, WebP, GIF, AVIF, TIFF или HEIC.');
 }
 return source.rotate().resize(512,512,{fit:'cover',withoutEnlargement:true}).webp({quality:85}).toBuffer();
}
