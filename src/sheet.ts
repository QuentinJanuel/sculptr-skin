/**
 * Cutting one packed sheet into the individual frames a sprite is loaded from.
 *
 * `Sprite.load` takes one picture per frame; a character is published as one picture. Slicing on
 * this side means the host serves one file per character rather than twelve, and that adding a
 * character there needs nothing from here.
 *
 * The cutting goes through the SDK's `sliceImage` rather than a canvas, which only exists in the
 * emulator -- a mod runs in the Electron main process when the game is installed.
 */

import { pngSize, sliceImage } from "@sculptr/sdk";
import { COLUMNS, FRAMES, type State, STATES, TILE } from "./skins";

/**
 * Cut a character's sheet up. One entry per state, each holding only the frames that actually
 * differ (see FRAMES).
 *
 * The size is checked rather than assumed: the sheet comes from outside this package, and one that
 * is not the shape this mod knows how to read would otherwise be sliced into nonsense and drawn
 * over somebody's game.
 */
export const sliceSheet = async function (
  sheet: Uint8Array,
): Promise<Record<State, Uint8Array[]>> {
  const { width, height } = pngSize(sheet);
  if (width !== COLUMNS * TILE || height !== STATES.length * TILE) {
    throw new Error(
      `the character sheet is ${width}x${height}, expected ` +
        `${COLUMNS * TILE}x${STATES.length * TILE}`,
    );
  }

  const out = {} as Record<State, Uint8Array[]>;
  for (const [row, state] of STATES.entries()) {
    const frames: Uint8Array[] = [];
    for (let column = 0; column < Math.min(FRAMES[state], COLUMNS); column += 1) {
      frames.push(
        await sliceImage(sheet, {
          x: column * TILE,
          y: row * TILE,
          width: TILE,
          height: TILE,
        }),
      );
    }
    out[state] = frames;
  }
  return out;
};
