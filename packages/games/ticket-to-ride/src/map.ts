/**
 * Ticket to Ride — North-America style map: 35 cities, 61 single routes.
 * Coordinates are layout hints for the UI (a 100×62 abstract space).
 * Deliberate simplification vs. the boxed game: no double routes.
 */

export type TrainColor =
  | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'black' | 'white';
export type RouteColor = TrainColor | 'gray';

export interface RouteDef {
  id: string;
  a: string;
  b: string;
  length: number;
  color: RouteColor;
}

export interface TicketDef {
  a: string;
  b: string;
  points: number;
}

export const CITY_POS: Record<string, [number, number]> = {
  seattle: [7, 7], portland: [5, 13], 'san-francisco': [4, 31], 'los-angeles': [8, 41],
  'las-vegas': [13, 35], phoenix: [16, 43], 'el-paso': [24, 49], 'santa-fe': [26, 41],
  denver: [28, 31], 'salt-lake-city': [17, 26], helena: [22, 14], calgary: [17, 4],
  winnipeg: [33, 5], duluth: [43, 13], omaha: [41, 24], 'kansas-city': [43, 30],
  'oklahoma-city': [42, 39], dallas: [44, 47], houston: [47, 54], 'new-orleans': [54, 53],
  'little-rock': [49, 41], 'saint-louis': [50, 30], nashville: [56, 35], chicago: [52, 20],
  'sault-st-marie': [56, 9], toronto: [63, 12], montreal: [69, 5], boston: [76, 11],
  'new-york': [73, 17], pittsburgh: [64, 21], washington: [72, 25], raleigh: [67, 31],
  atlanta: [60, 40], charleston: [68, 38], miami: [68, 56],
};

export const CITIES = Object.keys(CITY_POS);

function r(a: string, b: string, length: number, color: RouteColor): RouteDef {
  return { id: `${a}~${b}`, a, b, length, color };
}

export const ROUTES: RouteDef[] = [
  r('seattle', 'portland', 1, 'gray'),
  r('seattle', 'calgary', 4, 'gray'),
  r('seattle', 'helena', 6, 'yellow'),
  r('portland', 'san-francisco', 5, 'green'),
  r('portland', 'salt-lake-city', 6, 'blue'),
  r('san-francisco', 'salt-lake-city', 5, 'orange'),
  r('san-francisco', 'los-angeles', 3, 'yellow'),
  r('los-angeles', 'las-vegas', 2, 'gray'),
  r('los-angeles', 'phoenix', 3, 'gray'),
  r('los-angeles', 'el-paso', 6, 'black'),
  r('las-vegas', 'salt-lake-city', 3, 'orange'),
  r('phoenix', 'el-paso', 3, 'gray'),
  r('phoenix', 'santa-fe', 3, 'gray'),
  r('phoenix', 'denver', 5, 'white'),
  r('el-paso', 'santa-fe', 2, 'gray'),
  r('el-paso', 'houston', 6, 'green'),
  r('el-paso', 'oklahoma-city', 5, 'yellow'),
  r('santa-fe', 'denver', 2, 'gray'),
  r('santa-fe', 'oklahoma-city', 3, 'blue'),
  r('salt-lake-city', 'denver', 3, 'red'),
  r('salt-lake-city', 'helena', 3, 'purple'),
  r('calgary', 'helena', 4, 'gray'),
  r('calgary', 'winnipeg', 6, 'white'),
  r('helena', 'winnipeg', 4, 'blue'),
  r('helena', 'denver', 4, 'green'),
  r('helena', 'duluth', 6, 'orange'),
  r('helena', 'omaha', 5, 'red'),
  r('denver', 'omaha', 4, 'purple'),
  r('denver', 'kansas-city', 4, 'black'),
  r('denver', 'oklahoma-city', 4, 'red'),
  r('winnipeg', 'duluth', 4, 'black'),
  r('winnipeg', 'sault-st-marie', 6, 'gray'),
  r('duluth', 'omaha', 2, 'gray'),
  r('duluth', 'chicago', 3, 'red'),
  r('duluth', 'sault-st-marie', 3, 'gray'),
  r('omaha', 'kansas-city', 1, 'gray'),
  r('omaha', 'chicago', 4, 'blue'),
  r('kansas-city', 'saint-louis', 2, 'blue'),
  r('kansas-city', 'oklahoma-city', 2, 'gray'),
  r('oklahoma-city', 'dallas', 2, 'gray'),
  r('oklahoma-city', 'little-rock', 2, 'gray'),
  r('dallas', 'houston', 1, 'gray'),
  r('dallas', 'little-rock', 2, 'gray'),
  r('houston', 'new-orleans', 2, 'gray'),
  r('little-rock', 'new-orleans', 3, 'green'),
  r('little-rock', 'saint-louis', 2, 'gray'),
  r('little-rock', 'nashville', 3, 'white'),
  r('new-orleans', 'atlanta', 4, 'yellow'),
  r('new-orleans', 'miami', 6, 'red'),
  r('saint-louis', 'chicago', 2, 'green'),
  r('saint-louis', 'nashville', 2, 'gray'),
  r('chicago', 'pittsburgh', 3, 'orange'),
  r('chicago', 'toronto', 4, 'white'),
  r('sault-st-marie', 'toronto', 2, 'gray'),
  r('sault-st-marie', 'montreal', 5, 'black'),
  r('toronto', 'montreal', 3, 'gray'),
  r('toronto', 'pittsburgh', 2, 'gray'),
  r('montreal', 'boston', 2, 'gray'),
  r('montreal', 'new-york', 3, 'blue'),
  r('boston', 'new-york', 2, 'yellow'),
  r('new-york', 'pittsburgh', 2, 'green'),
  r('new-york', 'washington', 2, 'orange'),
  r('pittsburgh', 'washington', 2, 'gray'),
  r('pittsburgh', 'nashville', 4, 'yellow'),
  r('washington', 'raleigh', 2, 'gray'),
  r('raleigh', 'nashville', 3, 'black'),
  r('raleigh', 'atlanta', 2, 'gray'),
  r('raleigh', 'charleston', 2, 'gray'),
  r('atlanta', 'nashville', 1, 'gray'),
  r('atlanta', 'charleston', 2, 'gray'),
  r('atlanta', 'miami', 5, 'blue'),
  r('charleston', 'miami', 4, 'purple'),
];

export const ROUTE_BY_ID: Record<string, RouteDef> = Object.fromEntries(
  ROUTES.map((rt) => [rt.id, rt]),
);

export const TICKETS: TicketDef[] = [
  { a: 'los-angeles', b: 'new-york', points: 21 },
  { a: 'seattle', b: 'new-york', points: 22 },
  { a: 'san-francisco', b: 'atlanta', points: 17 },
  { a: 'portland', b: 'nashville', points: 17 },
  { a: 'seattle', b: 'los-angeles', points: 9 },
  { a: 'calgary', b: 'salt-lake-city', points: 7 },
  { a: 'calgary', b: 'phoenix', points: 13 },
  { a: 'montreal', b: 'new-orleans', points: 13 },
  { a: 'montreal', b: 'atlanta', points: 9 },
  { a: 'boston', b: 'miami', points: 12 },
  { a: 'new-york', b: 'atlanta', points: 6 },
  { a: 'chicago', b: 'santa-fe', points: 9 },
  { a: 'chicago', b: 'new-orleans', points: 7 },
  { a: 'duluth', b: 'houston', points: 8 },
  { a: 'duluth', b: 'el-paso', points: 10 },
  { a: 'helena', b: 'los-angeles', points: 8 },
  { a: 'winnipeg', b: 'miami', points: 20 },
  { a: 'winnipeg', b: 'houston', points: 12 },
  { a: 'denver', b: 'pittsburgh', points: 11 },
  { a: 'denver', b: 'el-paso', points: 4 },
  { a: 'kansas-city', b: 'houston', points: 5 },
  { a: 'dallas', b: 'new-york', points: 11 },
  { a: 'salt-lake-city', b: 'saint-louis', points: 9 },
  { a: 'toronto', b: 'miami', points: 10 },
  { a: 'portland', b: 'phoenix', points: 11 },
  { a: 'sault-st-marie', b: 'oklahoma-city', points: 9 },
];

export const TRAIN_COLORS: TrainColor[] = [
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white',
];

/** Points scored for claiming a route of a given length. */
export const ROUTE_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
