import { ManualJsonAdapter, type SourceConfig, type SourceAdapter } from "./types";
export const sourceRegistry: SourceConfig[] = [
 {id:"goo-net-exchange",market:"japan",enabled:true,mode:"manual-import",requestDelayMs:2500,allowed:true,notes:"Manual/public URL import; automated scraping disabled until source terms are approved."},
 {id:"carsensor",market:"japan",enabled:false,mode:"manual-import",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot."},
 {id:"beforward",market:"japan",enabled:false,mode:"manual-import",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot."},
 {id:"encar",market:"korea",enabled:true,mode:"manual-import",requestDelayMs:3000,allowed:true,notes:"Manual export supported; do not bypass Korean anti-bot controls."},
 {id:"kcar",market:"korea",enabled:false,mode:"manual-import",requestDelayMs:3000,allowed:false,notes:"Prepared adapter slot."},
 {id:"kb-chachacha",market:"korea",enabled:false,mode:"manual-import",requestDelayMs:3000,allowed:false,notes:"Prepared adapter slot."},
 {id:"autohome",market:"china",enabled:true,mode:"manual-import",requestDelayMs:3000,allowed:true,notes:"Manual JSON/CSV import only by default."},
 {id:"guazi",market:"china",enabled:false,mode:"manual-import",requestDelayMs:3000,allowed:false,notes:"Prepared adapter slot."},
 {id:"dongchedi",market:"china",enabled:false,mode:"manual-import",requestDelayMs:3000,allowed:false,notes:"Adapter placeholder."},
 {id:"che168",market:"china",enabled:false,mode:"manual-import",requestDelayMs:3000,allowed:false,notes:"Adapter placeholder."},
 {id:"dubicars",market:"uae",enabled:true,mode:"manual-import",requestDelayMs:2500,allowed:true,notes:"Manual import with public listing URL."},
 {id:"dubizzle",market:"uae",enabled:false,mode:"manual-import",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot."},
 {id:"carswitch",market:"uae",enabled:false,mode:"manual-import",requestDelayMs:2500,allowed:false,notes:"Adapter placeholder."},
 {id:"yallamotor",market:"uae",enabled:false,mode:"manual-import",requestDelayMs:2500,allowed:false,notes:"Adapter placeholder."},
 {id:"mobile-de",market:"europe",enabled:true,mode:"manual-import",requestDelayMs:2500,allowed:true,notes:"Manual export supported."},
 {id:"autoscout24",market:"europe",enabled:false,mode:"manual-import",requestDelayMs:2500,allowed:false,notes:"Prepared adapter slot."}
];
export function getSourceAdapters(): SourceAdapter[] { return sourceRegistry.map((config)=>new ManualJsonAdapter(config)); }
