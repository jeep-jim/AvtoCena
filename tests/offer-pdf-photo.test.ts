import test from "node:test";import assert from "node:assert/strict";
import {pdfPhotoUrl,publicPhotoAddress,fetchOfferPdfPhoto} from "../apps/web/lib/catalog/offer-pdf-photo";
test("PDF photo transport rejects local, private, metadata and mapped addresses",()=>{
 for(const address of ["127.0.0.1","10.0.0.1","169.254.169.254","172.16.0.1","192.168.1.1","100.64.1.1","0.0.0.0","224.0.0.1","::1","fc00::1","fe80::1","::ffff:127.0.0.1","2002:7f00:1::1","2001:db8::1"])assert.equal(publicPhotoAddress(address),false,address);
 for(const address of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"])assert.equal(publicPhotoAddress(address),true,address);
 assert.equal(pdfPhotoUrl("file:///etc/passwd"),null);assert.equal(pdfPhotoUrl("https://user:password@example.com/photo.jpg"),null);assert.equal(pdfPhotoUrl("http://example.com:8080/photo.jpg"),null);
 assert.equal(pdfPhotoUrl("/api/catalog/images/photo")?.hostname,"avtocena.com");
});
test("missing/invalid photo never blocks staff PDF generation",async()=>{assert.equal(await fetchOfferPdfPhoto(),null);assert.equal(await fetchOfferPdfPhoto("file:///etc/passwd"),null);});
