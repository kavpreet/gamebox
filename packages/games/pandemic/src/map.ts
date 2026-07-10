/** Classic Pandemic board: 48 cities, 4 diseases, standard connections. */

export type Disease = 'blue' | 'yellow' | 'black' | 'red';

export interface CityInfo {
  color: Disease;
  neighbors: string[];
}

const RAW: Record<string, { color: Disease; neighbors: string[] }> = {
  // ── blue ──
  'san-francisco': { color: 'blue', neighbors: ['tokyo', 'manila', 'los-angeles', 'chicago'] },
  chicago: { color: 'blue', neighbors: ['san-francisco', 'los-angeles', 'mexico-city', 'atlanta', 'montreal'] },
  atlanta: { color: 'blue', neighbors: ['chicago', 'washington', 'miami'] },
  montreal: { color: 'blue', neighbors: ['chicago', 'washington', 'new-york'] },
  washington: { color: 'blue', neighbors: ['atlanta', 'montreal', 'new-york', 'miami'] },
  'new-york': { color: 'blue', neighbors: ['montreal', 'washington', 'london', 'madrid'] },
  madrid: { color: 'blue', neighbors: ['new-york', 'london', 'paris', 'algiers', 'sao-paulo'] },
  london: { color: 'blue', neighbors: ['new-york', 'madrid', 'paris', 'essen'] },
  paris: { color: 'blue', neighbors: ['madrid', 'london', 'essen', 'milan', 'algiers'] },
  essen: { color: 'blue', neighbors: ['london', 'paris', 'milan', 'st-petersburg'] },
  milan: { color: 'blue', neighbors: ['essen', 'paris', 'istanbul'] },
  'st-petersburg': { color: 'blue', neighbors: ['essen', 'istanbul', 'moscow'] },
  // ── yellow ──
  'los-angeles': { color: 'yellow', neighbors: ['san-francisco', 'chicago', 'mexico-city', 'sydney'] },
  'mexico-city': { color: 'yellow', neighbors: ['los-angeles', 'chicago', 'miami', 'bogota', 'lima'] },
  miami: { color: 'yellow', neighbors: ['atlanta', 'washington', 'mexico-city', 'bogota'] },
  bogota: { color: 'yellow', neighbors: ['mexico-city', 'miami', 'lima', 'buenos-aires', 'sao-paulo'] },
  lima: { color: 'yellow', neighbors: ['mexico-city', 'bogota', 'santiago'] },
  santiago: { color: 'yellow', neighbors: ['lima'] },
  'buenos-aires': { color: 'yellow', neighbors: ['bogota', 'sao-paulo'] },
  'sao-paulo': { color: 'yellow', neighbors: ['bogota', 'buenos-aires', 'madrid', 'lagos'] },
  lagos: { color: 'yellow', neighbors: ['sao-paulo', 'kinshasa', 'khartoum'] },
  kinshasa: { color: 'yellow', neighbors: ['lagos', 'khartoum', 'johannesburg'] },
  johannesburg: { color: 'yellow', neighbors: ['kinshasa', 'khartoum'] },
  khartoum: { color: 'yellow', neighbors: ['lagos', 'kinshasa', 'johannesburg', 'cairo'] },
  // ── black ──
  algiers: { color: 'black', neighbors: ['madrid', 'paris', 'istanbul', 'cairo'] },
  cairo: { color: 'black', neighbors: ['algiers', 'istanbul', 'baghdad', 'riyadh', 'khartoum'] },
  istanbul: { color: 'black', neighbors: ['milan', 'st-petersburg', 'moscow', 'algiers', 'cairo', 'baghdad'] },
  moscow: { color: 'black', neighbors: ['st-petersburg', 'istanbul', 'tehran'] },
  baghdad: { color: 'black', neighbors: ['istanbul', 'cairo', 'riyadh', 'tehran', 'karachi'] },
  riyadh: { color: 'black', neighbors: ['cairo', 'baghdad', 'karachi'] },
  tehran: { color: 'black', neighbors: ['moscow', 'baghdad', 'karachi', 'delhi'] },
  karachi: { color: 'black', neighbors: ['baghdad', 'riyadh', 'tehran', 'delhi', 'mumbai'] },
  mumbai: { color: 'black', neighbors: ['karachi', 'delhi', 'chennai'] },
  delhi: { color: 'black', neighbors: ['tehran', 'karachi', 'mumbai', 'chennai', 'kolkata'] },
  chennai: { color: 'black', neighbors: ['mumbai', 'delhi', 'kolkata', 'bangkok', 'jakarta'] },
  kolkata: { color: 'black', neighbors: ['delhi', 'chennai', 'bangkok', 'hong-kong'] },
  // ── red ──
  beijing: { color: 'red', neighbors: ['shanghai', 'seoul'] },
  seoul: { color: 'red', neighbors: ['beijing', 'shanghai', 'tokyo'] },
  tokyo: { color: 'red', neighbors: ['seoul', 'shanghai', 'osaka', 'san-francisco'] },
  shanghai: { color: 'red', neighbors: ['beijing', 'seoul', 'tokyo', 'hong-kong', 'taipei'] },
  'hong-kong': { color: 'red', neighbors: ['shanghai', 'taipei', 'kolkata', 'bangkok', 'ho-chi-minh-city', 'manila'] },
  taipei: { color: 'red', neighbors: ['shanghai', 'hong-kong', 'osaka', 'manila'] },
  osaka: { color: 'red', neighbors: ['tokyo', 'taipei'] },
  bangkok: { color: 'red', neighbors: ['kolkata', 'chennai', 'hong-kong', 'ho-chi-minh-city', 'jakarta'] },
  jakarta: { color: 'red', neighbors: ['chennai', 'bangkok', 'ho-chi-minh-city', 'sydney'] },
  'ho-chi-minh-city': { color: 'red', neighbors: ['bangkok', 'hong-kong', 'jakarta', 'manila'] },
  manila: { color: 'red', neighbors: ['hong-kong', 'taipei', 'ho-chi-minh-city', 'sydney', 'san-francisco'] },
  sydney: { color: 'red', neighbors: ['jakarta', 'manila', 'los-angeles'] },
};

/** Symmetric-normalized city map. */
export const CITIES: Record<string, CityInfo> = (() => {
  const out: Record<string, CityInfo> = {};
  for (const [name, info] of Object.entries(RAW)) {
    out[name] = { color: info.color, neighbors: [] };
  }
  const seen = new Set<string>();
  for (const [name, info] of Object.entries(RAW)) {
    for (const n of info.neighbors) {
      const key = [name, n].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out[name]!.neighbors.push(n);
      out[n]!.neighbors.push(name);
    }
  }
  return out;
})();

export const CITY_NAMES: string[] = Object.keys(CITIES);
export const DISEASES: Disease[] = ['blue', 'yellow', 'black', 'red'];
