import type { SeededRandom } from '@gamebox/core-engine';

/**
 * Catan board geometry — the hex/vertex/edge graph (plan §4.2: vertices and
 * edges are first-class nodes; settlements sit on vertices, roads on edges).
 *
 * Hexes use axial coords (q,r), radius-2 hexagon = 19 tiles. Vertices use the
 * standard two-per-hex encoding: every vertex is the North or South corner of
 * exactly one hex, id `"q,r,N"` / `"q,r,S"`:
 *  - (q,r,N) touches hexes (q,r), (q,r-1), (q+1,r-1)
 *  - (q,r,S) touches hexes (q,r), (q,r+1), (q-1,r+1)
 * Edges are canonical sorted vertex-id pairs joined by '|'.
 */

export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';
export type TileType = Resource | 'desert';

export interface Hex {
  q: number;
  r: number;
  tile: TileType;
  token: number | null; // dice number, null on desert
}

export type VertexId = string; // "q,r,N" | "q,r,S"
export type EdgeId = string; // "vertexA|vertexB" sorted

export const hexKey = (q: number, r: number) => `${q},${r}`;

/** All 19 axial coords of the radius-2 board. */
export function boardHexCoords(): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) <= 2) out.push({ q, r });
    }
  }
  return out;
}

/** The 6 corner vertex-ids of hex (q,r). */
export function cornersOf(q: number, r: number): VertexId[] {
  return [
    `${q},${r},N`,
    `${q},${r + 1},N`,
    `${q - 1},${r + 1},N`,
    `${q},${r},S`,
    `${q},${r - 1},S`,
    `${q + 1},${r - 1},S`,
  ];
}

/** Hex coords a vertex touches (some may be off-board). */
export function hexesOfVertex(v: VertexId): { q: number; r: number }[] {
  const [qs, rs, side] = v.split(',');
  const q = Number(qs), r = Number(rs);
  return side === 'N'
    ? [{ q, r }, { q, r: r - 1 }, { q: q + 1, r: r - 1 }]
    : [{ q, r }, { q, r: r + 1 }, { q: q - 1, r: r + 1 }];
}

/** The (up to 3) neighboring vertices of a vertex. */
export function vertexNeighbors(v: VertexId): VertexId[] {
  const [qs, rs, side] = v.split(',');
  const q = Number(qs), r = Number(rs);
  return side === 'N'
    ? [`${q},${r - 1},S`, `${q + 1},${r - 1},S`, `${q + 1},${r - 2},S`]
    : [`${q},${r + 1},N`, `${q - 1},${r + 1},N`, `${q - 1},${r + 2},N`];
}

export function edgeId(a: VertexId, b: VertexId): EdgeId {
  return [a, b].sort().join('|');
}

export function edgeVertices(e: EdgeId): [VertexId, VertexId] {
  return e.split('|') as [VertexId, VertexId];
}

export interface BoardGeometry {
  hexes: Hex[];
  vertices: Set<VertexId>;
  edges: Set<EdgeId>;
}

/** Standard tile mix + token bag, randomized. */
export function generateBoard(rng: SeededRandom): BoardGeometry {
  const tiles: TileType[] = rng.shuffle([
    ...Array<TileType>(4).fill('wood'),
    ...Array<TileType>(4).fill('sheep'),
    ...Array<TileType>(4).fill('wheat'),
    ...Array<TileType>(3).fill('brick'),
    ...Array<TileType>(3).fill('ore'),
    'desert',
  ]);
  const tokens = rng.shuffle([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);

  const hexes: Hex[] = boardHexCoords().map(({ q, r }, i) => {
    const tile = tiles[i]!;
    return { q, r, tile, token: tile === 'desert' ? null : null };
  });
  // assign tokens to non-desert hexes
  let t = 0;
  for (const hex of hexes) {
    if (hex.tile !== 'desert') hex.token = tokens[t++]!;
  }

  const vertices = new Set<VertexId>();
  const edges = new Set<EdgeId>();
  for (const { q, r } of boardHexCoords()) {
    const corners = cornersOf(q, r);
    for (const v of corners) vertices.add(v);
  }
  for (const v of vertices) {
    for (const n of vertexNeighbors(v)) {
      if (vertices.has(n)) edges.add(edgeId(v, n));
    }
  }
  return { hexes, vertices, edges };
}

/** Pixel position for UI (pointy-top, unit size). */
export function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

export function vertexXY(v: VertexId): { x: number; y: number } {
  const [qs, rs, side] = v.split(',');
  const { x, y } = hexCenter(Number(qs), Number(rs));
  return { x, y: side === 'N' ? y - 1 : y + 1 };
}

export const COSTS: Record<'road' | 'settlement' | 'city' | 'dev', Partial<Record<Resource, number>>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};

export const RESOURCES: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
