"use client";
import type {ComponentProps} from 'react';
import {useRouter} from 'next/navigation';
import {InlineOfferParameters} from './InlineOfferParameters';

/** Route refresh stays outside the reusable editor and respects its dirty state. */
export function SyncedInlineOfferParameters(props:ComponentProps<typeof InlineOfferParameters>){
 const router=useRouter();
 return <InlineOfferParameters {...props} onKnowledgeRefresh={router.refresh}/>;
}
