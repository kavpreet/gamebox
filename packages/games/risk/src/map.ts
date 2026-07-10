/** Classic Risk world map: 42 territories, 6 continents, standard adjacency. */

export interface Continent {
  name: string;
  bonus: number;
  territories: string[];
}

export const CONTINENTS: Continent[] = [
  {
    name: 'North America',
    bonus: 5,
    territories: [
      'alaska', 'northwest-territory', 'greenland', 'alberta', 'ontario',
      'quebec', 'western-us', 'eastern-us', 'central-america',
    ],
  },
  {
    name: 'South America',
    bonus: 2,
    territories: ['venezuela', 'brazil', 'peru', 'argentina'],
  },
  {
    name: 'Europe',
    bonus: 5,
    territories: [
      'iceland', 'great-britain', 'scandinavia', 'ukraine',
      'northern-europe', 'southern-europe', 'western-europe',
    ],
  },
  {
    name: 'Africa',
    bonus: 3,
    territories: ['north-africa', 'egypt', 'east-africa', 'congo', 'south-africa', 'madagascar'],
  },
  {
    name: 'Asia',
    bonus: 7,
    territories: [
      'ural', 'siberia', 'yakutsk', 'kamchatka', 'irkutsk', 'mongolia', 'japan',
      'afghanistan', 'china', 'middle-east', 'india', 'siam',
    ],
  },
  {
    name: 'Oceania',
    bonus: 2,
    territories: ['indonesia', 'new-guinea', 'western-australia', 'eastern-australia'],
  },
];

const RAW_ADJACENCY: Record<string, string[]> = {
  alaska: ['northwest-territory', 'alberta', 'kamchatka'],
  'northwest-territory': ['alaska', 'alberta', 'ontario', 'greenland'],
  greenland: ['northwest-territory', 'ontario', 'quebec', 'iceland'],
  alberta: ['alaska', 'northwest-territory', 'ontario', 'western-us'],
  ontario: ['northwest-territory', 'alberta', 'greenland', 'quebec', 'western-us', 'eastern-us'],
  quebec: ['greenland', 'ontario', 'eastern-us'],
  'western-us': ['alberta', 'ontario', 'eastern-us', 'central-america'],
  'eastern-us': ['ontario', 'quebec', 'western-us', 'central-america'],
  'central-america': ['western-us', 'eastern-us', 'venezuela'],
  venezuela: ['central-america', 'brazil', 'peru'],
  brazil: ['venezuela', 'peru', 'argentina', 'north-africa'],
  peru: ['venezuela', 'brazil', 'argentina'],
  argentina: ['peru', 'brazil'],
  iceland: ['greenland', 'great-britain', 'scandinavia'],
  'great-britain': ['iceland', 'scandinavia', 'northern-europe', 'western-europe'],
  scandinavia: ['iceland', 'great-britain', 'northern-europe', 'ukraine'],
  ukraine: ['scandinavia', 'northern-europe', 'southern-europe', 'ural', 'afghanistan', 'middle-east'],
  'northern-europe': ['great-britain', 'scandinavia', 'ukraine', 'southern-europe', 'western-europe'],
  'southern-europe': ['northern-europe', 'ukraine', 'western-europe', 'north-africa', 'egypt', 'middle-east'],
  'western-europe': ['great-britain', 'northern-europe', 'southern-europe', 'north-africa'],
  'north-africa': ['brazil', 'western-europe', 'southern-europe', 'egypt', 'east-africa', 'congo'],
  egypt: ['southern-europe', 'north-africa', 'east-africa', 'middle-east'],
  'east-africa': ['egypt', 'north-africa', 'congo', 'south-africa', 'madagascar', 'middle-east'],
  congo: ['north-africa', 'east-africa', 'south-africa'],
  'south-africa': ['congo', 'east-africa', 'madagascar'],
  madagascar: ['east-africa', 'south-africa'],
  ural: ['ukraine', 'siberia', 'china', 'afghanistan'],
  siberia: ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china'],
  yakutsk: ['siberia', 'kamchatka', 'irkutsk'],
  kamchatka: ['yakutsk', 'irkutsk', 'mongolia', 'japan', 'alaska'],
  irkutsk: ['siberia', 'yakutsk', 'kamchatka', 'mongolia'],
  mongolia: ['siberia', 'irkutsk', 'kamchatka', 'japan', 'china'],
  japan: ['kamchatka', 'mongolia'],
  afghanistan: ['ukraine', 'ural', 'china', 'india', 'middle-east'],
  china: ['ural', 'siberia', 'mongolia', 'afghanistan', 'india', 'siam'],
  'middle-east': ['ukraine', 'southern-europe', 'egypt', 'east-africa', 'afghanistan', 'india'],
  india: ['afghanistan', 'china', 'middle-east', 'siam'],
  siam: ['china', 'india', 'indonesia'],
  indonesia: ['siam', 'new-guinea', 'western-australia'],
  'new-guinea': ['indonesia', 'western-australia', 'eastern-australia'],
  'western-australia': ['indonesia', 'new-guinea', 'eastern-australia'],
  'eastern-australia': ['new-guinea', 'western-australia'],
};

/** Symmetric adjacency (normalized so a one-sided typo can't break the graph). */
export const ADJACENCY: Record<string, Set<string>> = (() => {
  const adj: Record<string, Set<string>> = {};
  for (const t of Object.keys(RAW_ADJACENCY)) adj[t] = new Set();
  for (const [t, neighbors] of Object.entries(RAW_ADJACENCY)) {
    for (const n of neighbors) {
      adj[t]!.add(n);
      (adj[n] ?? (adj[n] = new Set())).add(t);
    }
  }
  return adj;
})();

export const TERRITORIES: string[] = Object.keys(RAW_ADJACENCY);

export function continentOf(territory: string): Continent | undefined {
  return CONTINENTS.find((c) => c.territories.includes(territory));
}
