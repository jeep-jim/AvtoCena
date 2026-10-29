import React from 'react';
import {useSearchParams} from 'next/navigation';
import {DirectoryAlphabet,DirectoryFilters} from '../../apps/web/components/encyclopedia/DirectoryFilters';
import {filterModels} from '../../apps/web/lib/encyclopedia/query';
import {KnowledgeDirectory} from '../../apps/web/components/encyclopedia/KnowledgeDirectory';
export const models=Array.from({length:4000},(_,i)=>({id:`model-${i}`,make:`Brand ${Math.floor(i/200)}`,model:`Model ${i%200}`,years:[2024],fuels:['petrol'],variants:1,needs30:0,photo:i===0?'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22160%22%3E%3Crect width=%22240%22 height=%22160%22 fill=%22%23374f68%22/%3E%3C/svg%3E':'',compact:{all:{fuel:'Бензин',engineCc:'1500',powerHp:'150',drive:'Передний',transmission:'Автомат',bodyType:'Седан',power30MinKw:'—'},years:{}},directorySnapshot:{capturedAt:'2026-10-27T07:00:00Z',count:123},updatedAt:'2026-10-26'}));
export function Fixture(){const params=useSearchParams();const makes=['Abarth',...new Set(models.map(m=>m.make)),'Toyota'];return <><div className="ac-knowledge-toolbar"><button className="ac-ency-button">Добавить модель</button><DirectoryAlphabet makes={makes}/></div><DirectoryFilters makes={makes} years={[2024]} fuels={['petrol']}/><KnowledgeDirectory models={filterModels(models as any,Object.fromEntries(params))} canEdit={false}/></>;}
