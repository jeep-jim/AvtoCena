export { AutoScoutEuropeExactAdapter, autoScoutSpecificationEvidence, parseAutoScoutNextData } from "./autoscout-exact-source-base";
export type { AutoScoutExactRow, AutoScoutSpecificationEvidence } from "./autoscout-exact-source-base";
export { AutoScoutHqAdapter, parseAutoScoutDetailGallery } from "./autoscout-hq-source";
export { AutoScoutCurrentAdapter } from "./autoscout-current-source";

import { autoscoutEuropeCurrentSource } from "./autoscout-current-source";
export const autoscoutEuropeExactSource = autoscoutEuropeCurrentSource;
