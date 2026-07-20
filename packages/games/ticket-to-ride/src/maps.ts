import type { RouteDef, TicketDef } from './map.js';
import { CITY_POS, ROUTES, TICKETS } from './map.js';
import { EUROPE_CITY_POS, EUROPE_ROUTES, EUROPE_TICKETS } from './europe.js';

/** One playable Ticket to Ride map. */
export interface TtrMapDef {
  id: string;
  name: string;
  cityPos: Record<string, [number, number]>;
  routes: RouteDef[];
  routeById: Record<string, RouteDef>;
  tickets: TicketDef[];
}

function def(
  id: string,
  name: string,
  cityPos: Record<string, [number, number]>,
  routes: RouteDef[],
  tickets: TicketDef[],
): TtrMapDef {
  return { id, name, cityPos, routes, routeById: Object.fromEntries(routes.map((r) => [r.id, r])), tickets };
}

export const MAPS: Record<string, TtrMapDef> = {
  'north-america': def('north-america', 'North America', CITY_POS, ROUTES, TICKETS),
  europe: def('europe', 'Europe', EUROPE_CITY_POS, EUROPE_ROUTES, EUROPE_TICKETS),
};
