import {UnavailableOfferView} from './UnavailableOfferView';
import {DeferredOfferRecommendations} from './DeferredOfferRecommendations';
import type {UnavailableOffer as UnavailableOfferRecord} from '@/lib/catalog/offer-availability';

export function UnavailableOffer({offer,calculationUnavailable=false}:{offer?:UnavailableOfferRecord|null;calculationUnavailable?:boolean}) {
  return <UnavailableOfferView offer={offer} calculationUnavailable={calculationUnavailable}><DeferredOfferRecommendations kind="alternatives" offerId={offer?.id}/></UnavailableOfferView>;
}
