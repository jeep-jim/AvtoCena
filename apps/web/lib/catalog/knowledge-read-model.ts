import {readBundledDataJson} from '../bundled-data';
import {catalogBrandSlug} from './brands';
import {DetailReadCache} from './detail-read-cache';
import type {CatalogModelKnowledgeSummary} from './model-directory';
export type KnowledgeVariant = {id:string;modelId:string;make:string;model:string;name?:string;yearFrom?:number;yearTo?:number;market?:string;engineCc?:number;fuel?:string;powerHp?:number;powerKw?:number;powertrainKind?:string;icePowerKw?:number;power30MinKw?:number;sourceIds?:string[];sourceUrl?:string;verifiedAt?:string;status:'reference'|'observation'};
const root='catalog/knowledge-read-model';
let summary:Promise<Record<string,CatalogModelKnowledgeSummary>>|undefined;
const variants=new DetailReadCache<KnowledgeVariant[]>({maxEntries:16,maxBytes:12*1024*1024,ttlMs:3600_000,concurrency:2});
export function readCompiledKnowledgeSummary(){return summary??=readBundledDataJson<Record<string,CatalogModelKnowledgeSummary>>(`${root}/summary.json`,{});}
export function readCompiledKnowledgeVariants(make:string){const key=catalogBrandSlug(make);return variants.get(key,()=>readBundledDataJson<KnowledgeVariant[]>(`${root}/${key}.json`,[]));}
