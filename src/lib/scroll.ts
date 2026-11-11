/** How close to the end of a scrolling list still counts as "reading the latest". */
export const FOLLOW_WITHIN_PX = 120;

/**
 * True when a scrolling list is at, or close to, its end. The chat follows a build's new steps only
 * then, so someone who scrolled up to read isn't pulled back down by every update.
 */
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, within = FOLLOW_WITHIN_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= within;
}
