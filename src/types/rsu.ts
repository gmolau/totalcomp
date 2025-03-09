export interface RSUGrant {
  grantDate: Date;
  quantity: number;
  grantPrice: number;
  symbol: string;
  currentPrice?: number;
  priceError?: string;
  vestingSchedule: VestingEvent[];
}

export interface StockPriceEntry {
  symbol: string;
  date: Date;
  price: number;
  isCurrentPrice?: boolean;  // Flag for automatically added current prices
}

export interface VestingEvent {
  date: Date;
  quantity: number;
  price?: number; // Stock price at vest date
  priceError?: string;
  value?: number; // Total value of vested shares at vest date
}

export interface RSUCalculatorState {
  grants: RSUGrant[];
  selectedGrantIndex: number | null;
} 