
/** PDF 1.5 optional content: visible initially, printable, no document JavaScript.
 * Viewers without SetOCGState support simply show the complete quote.
 * A PDF page remains fixed-size when a layer is hidden.
 */
export function offerPdfLayers(doc: PDFKit.PDFDocument, names: string[]) {
 const groups=names.map(name=>{const ref=doc.ref({Type:"OCG",Name:new String(name),Intent:["View","Design"],Usage:{Print:{PrintState:"ON"}}});ref.end(undefined);return ref;});
 const internals=doc as PDFKit.PDFDocument & {_root:{data:Record<string,unknown>}};
 internals._root.data.OCProperties={OCGs:groups,D:{Name:new String("Расчёт автомобиля"),BaseState:"ON",ON:groups,Order:groups,AS:[{Event:"Print",Category:["Print"],OCGs:groups}]}};
 return {
  toggle(index:number,x:number,y:number,w:number,h:number){doc.annotate(x,y,w,h,{Subtype:"Link",A:{S:"SetOCGState",State:["Toggle",groups[index]],PreserveRB:true}} as Parameters<typeof doc.annotate>[4]);},
  begin(index:number){const page=doc.page as typeof doc.page & {resources:{data:Record<string,any>}};page.resources.data.Properties ||= {};page.resources.data.Properties[`Quote${index}`]=groups[index];doc.addContent(`/OC /Quote${index} BDC`);},
  end(){doc.addContent("EMC");},
 };
}
