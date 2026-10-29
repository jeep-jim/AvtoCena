'use client';
import {useMemo} from 'react';
import {useSearchParams} from 'next/navigation';
import {filterModels} from '@/lib/encyclopedia/query';
import {unpackDirectory,type DirectoryWire} from '@/lib/encyclopedia/directory-wire';
import {KnowledgeDirectory} from './KnowledgeDirectory';
export function LocalDirectory({data,canEdit}:{data:DirectoryWire;canEdit:boolean}){
 const params=useSearchParams(),models=useMemo(()=>unpackDirectory(data),[data]);
 const filtered=useMemo(()=>filterModels(models,Object.fromEntries(params.entries())),[models,params]);
 const page=Math.min(Math.max(1,Math.floor(Number(params.get('page'))||1)),Math.max(1,Math.ceil(filtered.length/40)));
 return <KnowledgeDirectory models={filtered.slice((page-1)*40,page*40)} canEdit={canEdit} pagination={{page,total:filtered.length}}/>;
}
