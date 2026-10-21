import sharp from "sharp";

/** 400px catalog tiles retain 2x density; the full gallery keeps its 1800px image. */
export function renderCatalogPhoto(input: Buffer, card: boolean) {
  const size = card ? 800 : 1800;
  return sharp(input, {limitInputPixels: 32_000_000}).rotate()
    .resize({width: size, height: size, fit: "inside", withoutEnlargement: true})
    .webp({quality: 82, effort: card ? 2 : 4}).toBuffer();
}

export function renderSocialPhoto(input:Buffer){
 return sharp(input,{limitInputPixels:32_000_000}).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85,mozjpeg:true}).toBuffer();
}
