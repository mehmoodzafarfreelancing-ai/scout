/**
 * The accept/reject thresholds, in one place.
 *
 * The eval has to apply exactly the gates the pipeline applies, or it measures
 * a system nobody is running. Keeping the numbers here means the two cannot
 * drift apart silently.
 */

/** Below this a record says too little to extract from; skip the model. */
export const MIN_RECORD_CHARS = 400;

/**
 * Below this the extraction is discarded. Set at 0.4 because that is where
 * unreadable records and mis-parsed pages cluster once a model is asked to
 * score whether it read the record correctly.
 */
export const MIN_CONFIDENCE = 0.4;
