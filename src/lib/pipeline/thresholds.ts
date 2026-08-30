/**
 * The accept/reject thresholds, in one place.
 *
 * The eval has to apply exactly the gates the pipeline applies, or it measures
 * a system nobody is running. Keeping the numbers here means the two cannot
 * drift apart silently.
 */

/** Below this a page has too little text to be a funding call; skip the model. */
export const MIN_PAGE_CHARS = 400;

/**
 * Below this the extraction is discarded. Set at 0.4 because that is where
 * index pages, news posts and closed archives cluster once a model is asked to
 * score whether a page is genuinely a call it read correctly.
 */
export const MIN_CONFIDENCE = 0.4;
