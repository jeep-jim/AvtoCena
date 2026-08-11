import { cache } from "react";
import { getOffer } from "./storage";

// Metadata and the page render run in the same request. React cache prevents
// them from loading the same catalog chunk twice while keeping later requests fresh.
export const getOfferForPage = cache((id: string) => getOffer(id));
