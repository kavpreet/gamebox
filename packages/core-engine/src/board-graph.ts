/**
 * Shared board-topology primitive (plan §4.2): every requested game's board reduces
 * to a graph of position-nodes + adjacency edges. Storage/adjacency-query code is
 * shared here; only the legal-move generator differs per game.
 */
export interface BoardGraph<TCoord = string> {
  nodes: Map<string, TCoord>;
  edges: Map<string, Set<string>>;
}

export function createBoardGraph<TCoord>(): BoardGraph<TCoord> {
  return { nodes: new Map(), edges: new Map() };
}

export function addNode<TCoord>(graph: BoardGraph<TCoord>, id: string, coord: TCoord): void {
  graph.nodes.set(id, coord);
  if (!graph.edges.has(id)) graph.edges.set(id, new Set());
}

export function addEdge<TCoord>(graph: BoardGraph<TCoord>, a: string, b: string, directed = false): void {
  if (!graph.edges.has(a)) graph.edges.set(a, new Set());
  graph.edges.get(a)!.add(b);
  if (!directed) {
    if (!graph.edges.has(b)) graph.edges.set(b, new Set());
    graph.edges.get(b)!.add(a);
  }
}

export function neighbors<TCoord>(graph: BoardGraph<TCoord>, id: string): string[] {
  return Array.from(graph.edges.get(id) ?? []);
}

/** Builds an orthogonal grid graph (chess/checkers), node ids `"col,row"` zero-indexed. */
export function buildGridGraph(width: number, height: number): BoardGraph<{ x: number; y: number }> {
  const graph = createBoardGraph<{ x: number; y: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      addNode(graph, `${x},${y}`, { x, y });
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x + 1 < width) addEdge(graph, `${x},${y}`, `${x + 1},${y}`);
      if (y + 1 < height) addEdge(graph, `${x},${y}`, `${x},${y + 1}`);
    }
  }
  return graph;
}

/** Builds a simple cyclic/linear track graph (Snakes & Ladders, Ludo home stretch, Monopoly). */
export function buildTrackGraph(length: number, cyclic = false): BoardGraph<{ index: number }> {
  const graph = createBoardGraph<{ index: number }>();
  for (let i = 0; i < length; i++) addNode(graph, String(i), { index: i });
  for (let i = 0; i < length - 1; i++) addEdge(graph, String(i), String(i + 1), true);
  if (cyclic) addEdge(graph, String(length - 1), '0', true);
  return graph;
}
