import 'server-only';
import {isIP} from 'node:net';
// Offline country data: visitor IP never leaves the application for geolocation.
// Supplier-confirmed clusters, selected before the request; no retry on refusal.
export function ajesEndpoint(ip:string):string {
 if(!isIP(ip))throw Error('client_ip_missing');
 const geo=require('geoip-country') as {lookup:(ip:string)=>{country:string}|null};
 return geo.lookup(ip)?.country==='RU'?'http://87.242.72.57/api/':'http://78.46.90.228/api/';
}
