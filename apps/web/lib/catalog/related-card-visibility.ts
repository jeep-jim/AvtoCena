import {publicationWithdrawn} from './publication-policy';
import {isSellerPricedOffer} from './seller-price-contract';
import {hasModificationSelection} from './modification-contract';
import {catalogOfferVisibleRub} from './public-priority';

/** Check the public Japan DTO that CatalogCard will receive, after projection. */
export function japanRecommendationCardVisible(offer:any){
 if(offer?.market!=='japan')return true;
 if(publicationWithdrawn(offer))return false;
 return isSellerPricedOffer(offer)||hasModificationSelection(offer)||catalogOfferVisibleRub(offer)>0;
}
