/**
 * What a character's sheet looks like.
 *
 * ## The sheet
 *
 * One PNG per character, 128x128: four 32x32 frames across, four rows down — idle, run, jump,
 * fall, in that order. Rows shorter than four frames in the original art repeat their last frame
 * to fill the row, so `FRAMES` below is what an animation should actually cycle through, not what
 * the row physically holds.
 *
 * ## Where it comes from
 *
 * Handed over, not fetched: the host gives a mod the chosen character and its picture
 * (`mod.player`). Nothing about which characters exist, or where their pictures live, is compiled
 * into this package, so a character added to the host after this mod was published works, and so
 * does one somebody imported themselves.
 */

export const TILE = 32;
export const COLUMNS = 4;

export const STATES = ["idle", "run", "jump", "fall"] as const;
export type State = (typeof STATES)[number];

/** Distinct frames per row. */
export const FRAMES: Record<State, number> = { idle: 4, run: 4, jump: 2, fall: 2 };

/**
 * `image_speed` from the game these sprites come from, in frames per step. Kept because it is what
 * makes a skinned character move like the character it is, rather than at whatever rate looked
 * about right — idle ambles at a fifth of a frame per step, a run at half.
 */
export const IMAGE_SPEED: Record<State, number> = { idle: 0.2, run: 0.5, jump: 0.2, fall: 0.2 };
