import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { layeredOutlinesToDxf, outlinesToDxf, type DxfPoint } from "@/lib/dxfExport";
import { laserColorKey, laserColors, laserLayerGroups, laserProcessFor, normalizedKerf, withKerf } from "@/lib/laserLayers";
import { toSvgLaserLayers } from "@/lib/svgExport";

const square = (x: number, y: number, size: number): DxfPoint[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];

/** The DXF's entities as [layer, colour] pairs, in the order they are written. */
function entityLayers(dxf: string) {
  const lines = dxf.split("\r\n").map((line) => line.trim());
  const start = lines.indexOf("ENTITIES");
  const end = lines.indexOf("ENDSEC", start);
  const found: Array<[string, string]> = [];
  for (let index = start; index < end; index += 2) {
    if (lines[index] === "8") found.push([lines[index + 1], lines[index + 3]]);
  }
  return found;
}

describe("laser layers by colour", () => {
  it("reads a colour the same however it is written, and cuts what has no layer of its own", () => {
    expect(laserColorKey("#F00")).toBe("#ff0000");
    expect(laserColorKey(" #FF0000 ")).toBe("#ff0000");
    expect(laserColors(["#f00", "#FF0000", "#00f"])).toEqual(["#ff0000", "#0000ff"]);
    expect(laserProcessFor({ processes: { "#0000ff": "engrave" }, kerf: 0 }, "#00F")).toBe("engrave");
    expect(laserProcessFor({ processes: {}, kerf: 0 }, "#123456")).toBe("cut");
  });

  it("groups the bodies engrave, score, cut, and leaves out a colour set to leave out", () => {
    const bodies = [{ color: "#ff0000" }, { color: "#000000" }, { color: "#00ff00" }, { color: "#0000ff" }, { color: "#ff0000" }];
    const groups = laserLayerGroups(bodies, { processes: { "#000000": "engrave", "#0000ff": "score", "#00ff00": "skip" }, kerf: 0 });
    expect(groups).toEqual([
      { process: "engrave", indices: [1] },
      { process: "score", indices: [3] },
      { process: "cut", indices: [0, 4] },
    ]);
  });

  it("keeps the kerf between 0 and 2 mm", () => {
    expect(normalizedKerf(0.15)).toBe(0.15);
    expect(normalizedKerf(-1)).toBe(0);
    expect(normalizedKerf(9)).toBe(2);
    expect(normalizedKerf(Number.NaN)).toBe(0);
  });
});

describe("DXF on laser layers", () => {
  it("writes the plain file on layer 0 in colour 7, as before", () => {
    const { dxf } = outlinesToDxf({ loops: [square(0, 0, 10)] });
    expect(entityLayers(dxf).every(([layer, color]) => layer === "0" && color === "7")).toBe(true);
  });

  it("puts each layer's lines on that layer in its colour, all moved alike", () => {
    const result = layeredOutlinesToDxf([
      { name: "ENGRAVE", color: 7, loops: [square(20, 20, 5)] },
      { name: "CUT", color: 1, loops: [square(10, 10, 30)] },
    ]);
    const layers = entityLayers(result.dxf);
    expect(layers.slice(0, 4).every(([layer, color]) => layer === "ENGRAVE" && color === "7")).toBe(true);
    expect(layers.slice(4).every(([layer, color]) => layer === "CUT" && color === "1")).toBe(true);
    expect(result.width).toBeCloseTo(30, 9);
    expect(result.height).toBeCloseTo(30, 9);
    // The layer table holds 0 and both named layers.
    expect(result.dxf).toMatch(/LAYER\r\n {2}5\r\n[0-9A-F]+\r\n330\r\n1\r\n100\r\nAcDbSymbolTableRecord\r\n100\r\nAcDbLayerTableRecord\r\n {2}2\r\nCUT\r\n 70\r\n0\r\n 62\r\n1/);
    // The engraved square keeps its place inside the cut one: 10 mm in from the left, as drawn.
    const engraved = result.entities.slice(0, 4).flatMap((entity) => (entity.type === "line" ? [entity.from[0]] : []));
    expect(Math.min(...engraved)).toBeCloseTo(10, 9);
  });
});

describe("SVG on laser layers", () => {
  it("draws cuts as red hairlines, scores as blue ones and engravings as black areas, engraving first", () => {
    const svg = toSvgLaserLayers([
      { process: "cut", polygons: [square(0, 0, 30)] },
      { process: "engrave", polygons: [square(5, 5, 5)] },
      { process: "score", polygons: [square(15, 15, 5)] },
    ]);
    expect(svg).toContain('width="30mm" height="30mm"');
    const engrave = svg.indexOf('id="engrave"');
    const score = svg.indexOf('id="score"');
    const cut = svg.indexOf('id="cut"');
    expect(engrave).toBeGreaterThan(0);
    expect(score).toBeGreaterThan(engrave);
    expect(cut).toBeGreaterThan(score);
    expect(svg).toContain('fill="#000000" fill-rule="evenodd" stroke="none"');
    expect(svg).toContain('fill="none" stroke="#0000ff"');
    expect(svg).toContain('fill="none" stroke="#ff0000"');
  });
});

describe("kerf compensation", () => {
  let runtime: ManifoldToplevel;
  beforeAll(async () => {
    runtime = await manifoldModule();
    runtime.setup();
  });

  it("grows a plate by half the kerf all round and shrinks its hole by the same, corners square", () => {
    const created: unknown[] = [];
    // A 20 mm plate with a 10 mm square hole in the middle.
    const plate = new runtime.CrossSection([square(0, 0, 20), square(5, 5, 10).reverse()], "EvenOdd");
    const grown = withKerf(plate, 0.2, created);
    const bounds = grown.bounds();
    expect(bounds.min[0]).toBeCloseTo(-0.1, 6);
    expect(bounds.max[0]).toBeCloseTo(20.1, 6);
    // 20.2² outside less 9.8² hole; square corners keep the area exact.
    expect(grown.area()).toBeCloseTo(20.2 * 20.2 - 9.8 * 9.8, 4);
    expect(created).toEqual([grown]);
    expect(withKerf(plate, 0, created)).toBe(plate);
    [plate, ...created].forEach((section) => (section as { delete(): void }).delete());
  });
});
