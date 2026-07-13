import { ManualJsonAdapter, type SourceConfig, type SourceAdapter } from "./types";
export const sourceRegistry: SourceConfig[] = [
 {id:"goo-net-exchange",market:"japan",enabled:true,mode:"manual-import",status:"operational_manual",requestDelayMs:2500,allowed:true,notes:"Manual/public URL import; automated scraping disabled until source terms are approved."},
 {id:"carsensor",market:"japan",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot; not approved for automated import."},
 {id:"beforward",market:"japan",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot; not approved for automated import."},
 {id:"encar",market:"korea",enabled:true,mode:"manual-import",status:"operational_manual",requestDelayMs:3000,allowed:true,notes:"Manual export supported; do not bypass Korean anti-bot controls."},
 {id:"kcar",market:"korea",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:3000,allowed:false,notes:"Prepared adapter slot; not approved for automated import."},
 {id:"kb-chachacha",market:"korea",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:3000,allowed:false,notes:"Prepared adapter slot; not approved for automated import."},
 {id:"autohome",market:"china",enabled:true,mode:"manual-import",status:"operational_manual",requestDelayMs:3000,allowed:true,notes:"Manual JSON/CSV import only by default."},
 {id:"guazi",market:"china",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:3000,allowed:false,notes:"Prepared adapter slot; not approved for automated import."},
 {id:"dongchedi",market:"china",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:3000,allowed:false,notes:"Adapter placeholder; awaiting source review."},
 {id:"che168",market:"china",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:3000,allowed:false,notes:"Adapter placeholder; awaiting source review."},
 {id:"dubicars",market:"uae",enabled:true,mode:"manual-import",status:"operational_manual",requestDelayMs:2500,allowed:true,notes:"Manual import with public listing URL."},
 {id:"dubizzle",market:"uae",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot; not approved for automated import."},
 {id:"carswitch",market:"uae",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:2500,allowed:false,notes:"Adapter placeholder; awaiting source review."},
 {id:"yallamotor",market:"uae",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:2500,allowed:false,notes:"Adapter placeholder; awaiting source review."},
 {id:"mobile-de",market:"europe",enabled:true,mode:"manual-import",status:"operational_manual",requestDelayMs:2500,allowed:true,notes:"Manual export supported."},
 {id:"autoscout24",market:"europe",enabled:false,mode:"manual-import",status:"awaiting_approval",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot; not approved for automated import."}
];
export function getSourceAdapters(): SourceAdapter[] { return sourceRegistry.map((config)=>new ManualJsonAdapter(config)); }
