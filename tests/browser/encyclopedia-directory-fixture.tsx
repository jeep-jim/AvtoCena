import React from 'react';
import {KnowledgeDirectory} from '../../apps/web/components/encyclopedia/KnowledgeDirectory';
export const models=Array.from({length:4000},(_,i)=>({id:`model-${i}`,make:`Brand ${Math.floor(i/200)}`,model:`Model ${i%200}`,years:[2024],fuels:['petrol'],variants:1,needs30:0,photo:'',updatedAt:'2026-10-26'}));
export function Fixture(){return <KnowledgeDirectory models={models as any} canEdit={false}/>;}
