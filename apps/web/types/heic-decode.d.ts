declare module 'heic-decode' {
 type Decoded={width:number;height:number;data:Uint8ClampedArray};
 interface Image {width:number;height:number;decode():Promise<Decoded>}
 interface Images extends Array<Image>{dispose():void}
 const decode:{all(options:{buffer:Buffer}):Promise<Images>};
 export default decode;
}
