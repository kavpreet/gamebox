/** Standard US Monopoly board: 40 spaces. */

export type SpaceType =
  | 'go' | 'street' | 'railroad' | 'utility' | 'tax'
  | 'chance' | 'chest' | 'jail' | 'free-parking' | 'go-to-jail';

export interface Space {
  name: string;
  type: SpaceType;
  price?: number;
  /** streets: rent by houses 0..4 then hotel */
  rent?: [number, number, number, number, number, number];
  group?: string;
  houseCost?: number;
  taxAmount?: number;
}

export const BOARD: Space[] = [
  { name: 'GO', type: 'go' },
  { name: 'Mediterranean Avenue', type: 'street', price: 60, rent: [2, 10, 30, 90, 160, 250], group: 'brown', houseCost: 50 },
  { name: 'Community Chest', type: 'chest' },
  { name: 'Baltic Avenue', type: 'street', price: 60, rent: [4, 20, 60, 180, 320, 450], group: 'brown', houseCost: 50 },
  { name: 'Income Tax', type: 'tax', taxAmount: 200 },
  { name: 'Reading Railroad', type: 'railroad', price: 200 },
  { name: 'Oriental Avenue', type: 'street', price: 100, rent: [6, 30, 90, 270, 400, 550], group: 'light-blue', houseCost: 50 },
  { name: 'Chance', type: 'chance' },
  { name: 'Vermont Avenue', type: 'street', price: 100, rent: [6, 30, 90, 270, 400, 550], group: 'light-blue', houseCost: 50 },
  { name: 'Connecticut Avenue', type: 'street', price: 120, rent: [8, 40, 100, 300, 450, 600], group: 'light-blue', houseCost: 50 },
  { name: 'Jail / Just Visiting', type: 'jail' },
  { name: 'St. Charles Place', type: 'street', price: 140, rent: [10, 50, 150, 450, 625, 750], group: 'pink', houseCost: 100 },
  { name: 'Electric Company', type: 'utility', price: 150 },
  { name: 'States Avenue', type: 'street', price: 140, rent: [10, 50, 150, 450, 625, 750], group: 'pink', houseCost: 100 },
  { name: 'Virginia Avenue', type: 'street', price: 160, rent: [12, 60, 180, 500, 700, 900], group: 'pink', houseCost: 100 },
  { name: 'Pennsylvania Railroad', type: 'railroad', price: 200 },
  { name: 'St. James Place', type: 'street', price: 180, rent: [14, 70, 200, 550, 750, 950], group: 'orange', houseCost: 100 },
  { name: 'Community Chest', type: 'chest' },
  { name: 'Tennessee Avenue', type: 'street', price: 180, rent: [14, 70, 200, 550, 750, 950], group: 'orange', houseCost: 100 },
  { name: 'New York Avenue', type: 'street', price: 200, rent: [16, 80, 220, 600, 800, 1000], group: 'orange', houseCost: 100 },
  { name: 'Free Parking', type: 'free-parking' },
  { name: 'Kentucky Avenue', type: 'street', price: 220, rent: [18, 90, 250, 700, 875, 1050], group: 'red', houseCost: 150 },
  { name: 'Chance', type: 'chance' },
  { name: 'Indiana Avenue', type: 'street', price: 220, rent: [18, 90, 250, 700, 875, 1050], group: 'red', houseCost: 150 },
  { name: 'Illinois Avenue', type: 'street', price: 240, rent: [20, 100, 300, 750, 925, 1100], group: 'red', houseCost: 150 },
  { name: 'B&O Railroad', type: 'railroad', price: 200 },
  { name: 'Atlantic Avenue', type: 'street', price: 260, rent: [22, 110, 330, 800, 975, 1150], group: 'yellow', houseCost: 150 },
  { name: 'Ventnor Avenue', type: 'street', price: 260, rent: [22, 110, 330, 800, 975, 1150], group: 'yellow', houseCost: 150 },
  { name: 'Water Works', type: 'utility', price: 150 },
  { name: 'Marvin Gardens', type: 'street', price: 280, rent: [24, 120, 360, 850, 1025, 1200], group: 'yellow', houseCost: 150 },
  { name: 'Go To Jail', type: 'go-to-jail' },
  { name: 'Pacific Avenue', type: 'street', price: 300, rent: [26, 130, 390, 900, 1100, 1275], group: 'green', houseCost: 200 },
  { name: 'North Carolina Avenue', type: 'street', price: 300, rent: [26, 130, 390, 900, 1100, 1275], group: 'green', houseCost: 200 },
  { name: 'Community Chest', type: 'chest' },
  { name: 'Pennsylvania Avenue', type: 'street', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], group: 'green', houseCost: 200 },
  { name: 'Short Line', type: 'railroad', price: 200 },
  { name: 'Chance', type: 'chance' },
  { name: 'Park Place', type: 'street', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], group: 'dark-blue', houseCost: 200 },
  { name: 'Luxury Tax', type: 'tax', taxAmount: 100 },
  { name: 'Boardwalk', type: 'street', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], group: 'dark-blue', houseCost: 200 },
];

export const JAIL_POSITION = 10;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;

export interface CardEffect {
  text: string;
  effect:
    | { kind: 'money'; amount: number }
    | { kind: 'move-to'; position: number }
    | { kind: 'go-to-jail' }
    | { kind: 'repairs'; perHouse: number; perHotel: number }
    | { kind: 'collect-from-each'; amount: number };
}

export const CHANCE_CARDS: CardEffect[] = [
  { text: 'Advance to GO — collect $200', effect: { kind: 'move-to', position: 0 } },
  { text: 'Advance to Illinois Avenue', effect: { kind: 'move-to', position: 24 } },
  { text: 'Advance to Boardwalk', effect: { kind: 'move-to', position: 39 } },
  { text: 'Go directly to Jail', effect: { kind: 'go-to-jail' } },
  { text: 'Bank pays you a dividend of $50', effect: { kind: 'money', amount: 50 } },
  { text: 'Speeding fine — pay $15', effect: { kind: 'money', amount: -15 } },
  { text: 'General repairs: $25 per house, $100 per hotel', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { text: 'Your building loan matures — collect $150', effect: { kind: 'money', amount: 150 } },
];

export const CHEST_CARDS: CardEffect[] = [
  { text: 'Advance to GO — collect $200', effect: { kind: 'move-to', position: 0 } },
  { text: 'Bank error in your favor — collect $200', effect: { kind: 'money', amount: 200 } },
  { text: "Doctor's fee — pay $50", effect: { kind: 'money', amount: -50 } },
  { text: 'Go directly to Jail', effect: { kind: 'go-to-jail' } },
  { text: 'It is your birthday — collect $10 from every player', effect: { kind: 'collect-from-each', amount: 10 } },
  { text: 'Street repairs: $40 per house, $115 per hotel', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { text: 'You inherit $100', effect: { kind: 'money', amount: 100 } },
  { text: 'Income tax refund — collect $20', effect: { kind: 'money', amount: 20 } },
];
