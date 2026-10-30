/**
 * Laser layers for the top view's SVG and DXF: each body's colour says what the laser does with it, as LightBurn and
 * the cutting shops read a file - red is cut through, blue is scored (a line marked into the surface), black is
 * engraved (the area filled). A colour can also be left out of the file.
 *
 * The kerf is the width of material the beam burns away. Half of it on each side of a cut line makes a part come out
 * smaller and a hole larger; with kerf compensation the cut outline is moved out by half the kerf (a hole's edge into
 * the hole), so the part keeps the size it was drawn at.
 */

import type { CrossSection } from "manifold-3d";

export type LaserProcess = "cut" | "score" | "engrave" | "skip";

export const LASER_PROCESSES: readonly LaserProcess[] = ["cut", "score", "engrave", "skip"];

/** The colour a layer is written in: RGB for the SVG, the AutoCAD colour index for the DXF, and the DXF layer's name. */
export const LASER_LAYER_STYLE: Record<Exclude<LaserProcess, "skip">, { svgColor: string; dxfColor: number; dxfLayer: string }> = {
  cut: { svgColor: "#ff0000", dxfColor: 1, dxfLayer: "CUT" },
  score: { svgColor: "#0000ff", dxfColor: 5, dxfLayer: "SCORE" },
  engrave: { svgColor: "#000000", dxfColor: 7, dxfLayer: "ENGRAVE" },
};

/** Engraving first, then scoring, then cutting: a part that is cut free first could move before it is marked. */
export const LASER_LAYER_ORDER: readonly Exclude<LaserProcess, "skip">[] = ["engrave", "score", "cut"];

export const MAX_KERF = 2;

export type LaserLayerOptions = {
  /** What each body colour becomes, by laserColorKey; a colour not listed is cut. */
  processes: Readonly<Record<string, LaserProcess>>;
  /** The beam's kerf in mm; the cut outlines move out by half of it. 0 for none. */
  kerf: number;
};

export const DEFAULT_LASER_LAYERS: LaserLayerOptions = { processes: {}, kerf: 0 };

/** One key per colour however it is written: "#F00", "#ff0000" and " #FF0000 " are the same red. */
export function laserColorKey(color: string | undefined) {
  const value = (color ?? "#000000").trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value;
}

/** The body colours in the order they first come, once each. */
export function laserColors(colors: Iterable<string | undefined>) {
  return [...new Set([...colors].map(laserColorKey))];
}

export function laserProcessFor(options: LaserLayerOptions, color: string | undefined): LaserProcess {
  return options.processes[laserColorKey(color)] ?? "cut";
}

/** A kerf the export can use: a number from 0 to MAX_KERF mm, anything else 0. */
export function normalizedKerf(kerf: number) {
  return Number.isFinite(kerf) ? Math.min(MAX_KERF, Math.max(0, kerf)) : 0;
}

/**
 * The bodies grouped by what the laser does with them, in LASER_LAYER_ORDER, each group keeping the bodies' positions
 * in the list it came from; a group with no bodies and the colours left out are not in it.
 */
export function laserLayerGroups<T extends { color?: string }>(bodies: readonly T[], options: LaserLayerOptions) {
  return LASER_LAYER_ORDER.flatMap((process) => {
    const indices = bodies.flatMap((body, index) => (laserProcessFor(options, body.color) === process ? [index] : []));
    return indices.length ? [{ process, indices }] : [];
  });
}

/**
 * The cut outline moved out by half the kerf, corners kept square (a mitre), so the beam's width comes off outside the
 * part and inside its holes; without a kerf the section itself. A new section goes into `created`.
 */
export function withKerf(section: CrossSection, kerf: number, created: unknown[]) {
  const half = normalizedKerf(kerf) / 2;
  if (half <= 0) return section;
  const grown = section.offset(half, "Miter", 2);
  created.push(grown);
  return grown;
}
