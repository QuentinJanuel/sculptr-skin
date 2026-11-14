import { createMod, type HostSkin, type Mod, type Sprite } from "@sculptr/sdk";
import { findPlayerObjects } from "@sculptr/detect";
import { sliceSheet } from "./sheet";
import { STATES, type State } from "./skins";

/**
 * Draws the player as the character chosen in the host, whatever game it is.
 *
 * ## Which character
 *
 * Whichever one you picked. The host hands it over, picture and all (`mod.player`), so this mod
 * carries no pictures of its own: a character added to the host after this was published still
 * works, and so does one you imported yourself. Nothing picked means nothing to do: the game keeps
 * its own player.
 *
 * ## How the swap is done
 *
 * By replacing the game's own player sprites with `sprite_assign`, and then getting out of the
 * way. The game goes on choosing which pose to show, when to flip it, how fast to animate it and
 * where to draw it — all this mod changes is what those sprites contain.
 *
 * That is worth spelling out, because the obvious alternative is much worse. Hiding the player and
 * drawing over it means re-deriving everything the game already knows: which pose it is in, which
 * way it faces, whether gravity is flipped, where its feet are. Each is a guess from physics, each
 * is wrong for some game — a dash, a double jump, a water level — and together they were most of
 * an earlier version of this mod. Swapping the sprites has no such failure mode: if the game shows
 * its run animation, the run animation is yours.
 *
 * ## Finding them: at runtime, by name
 *
 * The game is asked, rather than its code being read. An earlier attempt harvested sprite names
 * out of the decompiled GML, which worked on GameMaker 8 and silently found nothing on Studio:
 * GM8 keeps `sprite_index = sprPlayerIdle` as a named asset, while Studio compiles it to a bare
 * integer, and the name is simply not in the code any more.
 *
 * `sprite_get_name` is in both engines and answers the same question directly, so the scan below
 * walks the game's sprites and matches on what they are called. It is one pass at startup, it does
 * not care which dialect built the game, and it also finds a sprite the game never names in code
 * at all -- one set in the object editor and never assigned.
 */

/** A name has to say it is the player, and say which pose, in that order — so `sprJumpBlock` and
 *  `sprFireballPlayer` are both left alone. Longest first, so `running` wins over the `run` in
 *  it. */
const POSE_WORDS: readonly (readonly [string, State])[] = [
  ["idle", "idle"],
  ["standing", "idle"],
  ["stand", "idle"],
  ["running", "run"],
  ["walking", "run"],
  ["run", "run"],
  ["walk", "run"],
  ["jumping", "jump"],
  ["jump", "jump"],
  ["falling", "fall"],
  ["fall", "fall"],
];

/** Sprite ids are allocated from zero, so the scan stops once it is well past the last one. The
 *  gap it stops on cannot be the game's own: `sprite_add` appends this mod's sprites right after
 *  them, so the run of live ids is unbroken up to ours. */
const SCAN_LIMIT = 20000;
const SCAN_GAP = 500;

/** Frames one sprite has to hold one pose before it is skinned.
 *
 *  A threshold rather than the first sighting, because a single frame proves nothing: a player
 *  passes through a pose for one step at the apex of a jump, and shooting or dying swaps the
 *  sprite for a moment. Quarter of a second of *the same* sprite in *the same* pose is something a
 *  transient cannot fake, and every pose reaches it within a few seconds of ordinary play. */
const POSE_FRAMES = 12;

/** Ignore movement below this many pixels per step when reading a pose off the player.
 *  Not zero: a game that positions its player with non-integer arithmetic jitters by a fraction of
 *  a pixel while standing perfectly still, and that must still read as standing still. */
const STILL = 0.02;

const install = function (mod: Mod, initial: HostSkin): void {
  let skin = initial;
  // No origin: whatever the game's sprite had is restored after the assign, so one set here would
  // only ever be overwritten.
  const sprites = {} as Record<State, Sprite>;
  for (const state of STATES) sprites[state] = mod.resource.sprite.create(state);

  /* Fills this mod's own sprites with a character. Run once at startup and again whenever the
     player picks a different one -- `sprite_assign` copies, so the game's sprites keep whatever was
     in ours at the time and have to be assigned again afterwards (see the `reskin` message). */
  const draw = async (next: HostSkin): Promise<void> => {
    const frames = await sliceSheet(next.sheet);
    for (const state of STATES) await sprites[state].load(frames[state]);
    console.log(`[skin] drawing the player as "${next.id}"`);
  };

  void draw(initial)
    // Re-assigned once the picture has actually landed, exactly as a change of character is.
    //
    // The game does not wait for it: the SDK puts each sprite back from the scratch files the last
    // transfer left behind, in the inbox's Create, so the slot is filled on the very first frame --
    // with *last session's* character. The scan below sees a ready sprite and assigns it, and the
    // real one arrives moments later into this mod's sprites where nothing copies it onward.
    // `sprite_assign` copies, so a picture that changes after the assign changes nothing on screen.
    //
    // That is why a new character only appeared after `game_restart()`: the restart re-ran the scan
    // against sprites that by then held the right picture. Nobody noticed while the character was
    // the same one, because the restored picture and the new one were identical.
    .then(() => mod.send("reskin"))
    .catch((error: unknown) => {
      // The sprites stay at -1 and the scan below never runs, so the game keeps its own player. A
      // mod that cannot read its pictures should leave the game as it found it.
      console.warn("[skin] could not load the character, leaving the game's own player:", error);
    });

  mod.onPlayerChange((player) => {
    // Nothing to do for a player who just signed out: the game's own sprites were overwritten long
    // ago and there is no copy of them to put back. Keeping the character beats a blank player.
    if (!player.skin || player.skin.id === skin.id) return;
    skin = player.skin;
    void draw(player.skin)
      .then(() => mod.send("reskin"))
      .catch((error: unknown) => {
        // Whatever was already loaded stays on screen, which is the character they had a moment
        // ago -- a worse answer than the new one, and a much better one than nothing.
        console.warn("[skin] could not load the new character, keeping the last one:", error);
      });
  });

  const notOurs = (target: string): string =>
    STATES.map((state) => `${target} != ${sprites[state].id}`).join(" && ");
  const ready = STATES.map((state) => `${sprites[state].id} >= 0`).join(" && ");

  /* Which pose this name claims, or -1. Each word has to appear *after* the word that said this is
     the player, so `sprKidnapper` is not a run cycle. First match wins, and POSE_WORDS is ordered
     so the longer spelling of a pose is tried first. */
  const poseOf = POSE_WORDS.map(
    ([word, state]) => `
          if (skin_pose < 0) {
            skin_at = string_pos("${word}", skin_name);
            if (skin_at > skin_who) skin_pose = ${STATES.indexOf(state)};
          }`,
  ).join("");

  /* Swap one sprite, putting the game's own origin back on top of it. `sprite_assign` copies the
     source whole, origin included, so without this the character hangs from wherever this mod's
     sheet happened to. Rescaled rather than copied: the sheet's cells are 32px and the game's
     sprite may not be, and what the two agree on is where the feet are, not where the top of the
     frame is. */
  const swapTo = (state: State, target: string) => `
              skin_w = sprite_get_width(${target});
              skin_h = sprite_get_height(${target});
              skin_x = sprite_get_xoffset(${target});
              skin_y = sprite_get_yoffset(${target});
              sprite_assign(${target}, ${sprites[state].id});
              if (skin_w > 0 && skin_h > 0) {
                skin_nw = sprite_get_width(${target});
                skin_nh = sprite_get_height(${target});
                sprite_set_offset(
                  ${target},
                  skin_nw / 2 + (skin_x - skin_w / 2) * (skin_nw / skin_w),
                  skin_nh - (skin_h - skin_y) * (skin_nh / skin_h)
                );
              }`;

  /** The swap, dispatched on a pose held in `skin_pose` at runtime. */
  const applyPoseTo = (target: string) =>
    STATES.map(
      (state, index) => `
            if (skin_pose == ${index}) {${swapTo(state, target)}
            }`,
    ).join("");

  /* Every local the GML below uses. Declared in one place because GM8 scopes `var` to the whole
     event, and a name missed here silently becomes an instance variable that survives the frame. */
  const locals = `
        var skin_i, skin_gap, skin_name, skin_who, skin_at, skin_pose, skin_count,
            skin_w, skin_h, skin_x, skin_y, skin_nw, skin_nh,
            skin_spr, skin_dx, skin_dy, skin_flip, skin_down, skin_found, skin_p, skin_taken;`;

  /* Who to watch, when the sprite names say nothing.

     `@sculptr/detect` answers this for every mod that needs it -- the quicksave and Twitch mods
     have run on the same call for as long as they have existed. It hands back an id (`(7)`) rather
     than a name, which matters here: Kamilia 3 has an object *called* `move_outside_solid`, and
     GML would read that as the builtin function. */
  const found = findPlayerObjects(mod.content);
  const watching = found.ok ? found.value.candidates[0] : null;

  /* Emitted only when there is somebody to watch, so a game the names already answered -- or one
     detect could make nothing of -- carries none of this. */
  const observe = (v: Record<string, string>, send: (e: string, x?: string) => string): string =>
    watching
      ? `/* Learn which sprite the player wears in which pose, by watching it. The pose is read off
           the instance's own movement rather than guessed from the game's variables -- a fangame
           may move its player with hspeed, or by assigning x directly, or from a script, and
           xprevious/yprevious are true whichever it picked. */
        if (${v.done} && ${ready} && instance_exists(${watching.ref})) {
          skin_pose = -1;
          skin_spr = -1;
          with (${watching.ref}) {
            skin_dx = x - xprevious;
            skin_dy = y - yprevious;
            /* Which way is down *for this instance*. Gravity flips are the genre's signature
               mechanic, and without this every jump upside-down reads as a fall. */
            skin_flip = 1;
            if (image_yscale < 0) skin_flip = -1;
            if (gravity < 0) skin_flip = -1;
            skin_down = skin_dy * skin_flip;
            if (abs(skin_down) < ${STILL}) {
              if (abs(skin_dx) < ${STILL}) skin_pose = 0; else skin_pose = 1;
            } else {
              if (skin_down < 0) skin_pose = 2; else skin_pose = 3;
            }
            skin_spr = sprite_index;
          }
          if (skin_pose >= 0 && skin_spr >= 0 && ${v.found}[skin_pose] == -1
              && sprite_exists(skin_spr) && ${notOurs("skin_spr")}) {
            if (skin_spr == ${v.cand}[skin_pose]) {
              ${v.streak}[skin_pose] += 1;
            } else {
              ${v.cand}[skin_pose] = skin_spr;
              ${v.streak}[skin_pose] = 1;
            }
            if (${v.streak}[skin_pose] >= ${POSE_FRAMES}) {
              /* A sprite already skinned for another pose is left alone rather than reassigned:
                 a game that idles and runs on one sprite gets the first pose that earned it, and
                 taking it for the second would only overwrite the first with different frames. */
              skin_taken = 0;
              for (skin_p = 0; skin_p < ${STATES.length}; skin_p += 1) {
                if (${v.found}[skin_p] == skin_spr) skin_taken = 1;
              }
              if (skin_taken) {
                ${v.found}[skin_pose] = -2;
              } else {
                ${v.found}[skin_pose] = skin_spr;
                skin_found = skin_spr;
                ${applyPoseTo("skin_found")}
                ${send("learned", `string(skin_pose)`)}
              }
            }
          }
        }`
      : "";

  mod.resource.object.create({
    name: "skin",
    vars: ["done", "cand", "streak", "found"],
    /* The player picked a different character and its pictures have landed. The name scan is
       re-armed, and anything the watcher already learned is re-assigned on the spot -- it does not
       need discovering twice, and `sprite_assign` copies, so last character's picture is sitting in
       the game's sprites until this runs. */
    receive: {
      reskin: ({ v }) => `${locals}
        ${v.done} = 0;
        for (skin_p = 0; skin_p < ${STATES.length}; skin_p += 1) {
          if (${v.found}[skin_p] >= 0) {
            skin_pose = skin_p;
            skin_found = ${v.found}[skin_p];
            ${applyPoseTo("skin_found")}
          }
        }`,
    },
    events: {
      create: ({ v }) => `${locals}
        ${v.done} = 0;
        for (skin_p = 0; skin_p < ${STATES.length}; skin_p += 1) {
          ${v.cand}[skin_p] = -1;
          ${v.streak}[skin_p] = 0;
          ${v.found}[skin_p] = -1;
        }`,
      /* Once, as soon as the pictures have arrived -- they are transferred while the game runs, so
         they are not there on the first frame. Re-armed by the Create above, which is what makes a
         `game_restart()` work: it reloads the game's own sprites, and this puts ours back. */
      endStep: ({ v, send }) => `${locals}
        if (!${v.done} && ${ready}) {
          ${v.done} = 1;
          skin_count = 0;
          skin_i = 0;
          skin_gap = 0;
          while (skin_i < ${SCAN_LIMIT} && skin_gap < ${SCAN_GAP}) {
            if (!sprite_exists(skin_i)) {
              skin_gap += 1;
            } else {
              skin_gap = 0;
              if (${notOurs("skin_i")}) {
                skin_name = string_lower(sprite_get_name(skin_i));
                skin_who = string_pos("player", skin_name);
                if (skin_who == 0) skin_who = string_pos("kid", skin_name);
                if (skin_who > 0) {
                  skin_pose = -1;${poseOf}${applyPoseTo("skin_i")}
                  if (skin_pose >= 0) skin_count += 1;
                }
              }
            }
            skin_i += 1;
          }
          ${send("skinned", "string(skin_count)")}
        }
        ${observe(v, send)}
      `,
    },
  });

  mod.on("skinned", (count) => {
    if (count !== "0") {
      console.log(`[skin] replaced ${count} sprite(s)`);
    } else if (watching) {
      console.log(
        `[skin] no player sprites found by name; watching ${watching.ref} "${watching.name}" ` +
          `(found by ${watching.source}) instead`,
      );
    } else {
      console.warn("[skin] no player sprites found in this game, and no player object to watch");
    }
  });

  mod.on("learned", (pose) => {
    console.log(`[skin] learned the player's "${STATES[Number(pose)] ?? pose}" sprite by watching it`);
  });
};

export default createMod((mod) => {
  const skin = mod.getPlayer().skin;
  if (!skin) {
    console.log("[skin] no character chosen in the host, leaving the game's own player");
    return;
  }
  install(mod, skin);
});
