export type DealerSubscriptions={version:1;subscribers:Record<string,{createdAt:string}>};
export const emptyDealerSubscriptions=():DealerSubscriptions=>({version:1,subscribers:{}});
export function subscriptionState(value:DealerSubscriptions,key:string){return {count:Object.keys(value.subscribers).length,subscribed:!!value.subscribers[key]};}
export function updateSubscription(value:DealerSubscriptions,key:string,subscribed:boolean,now=new Date().toISOString()):DealerSubscriptions{const subscribers={...value.subscribers};if(subscribed)subscribers[key]||={createdAt:now};else delete subscribers[key];return {version:1,subscribers};}
