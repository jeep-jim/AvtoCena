import {createRecommendationsHandler} from './handler';
import {loadRelatedRecommendations,loadAlternativeRecommendations} from './data';

export const dynamic='force-dynamic';
export const revalidate=0;
export const GET=createRecommendationsHandler({related:loadRelatedRecommendations,alternatives:loadAlternativeRecommendations});
