const API_KEY = 'demo'; // Replace with your Alpha Vantage API key
const CORS_PROXY = 'https://cors-proxy.fringe.zone/';

export async function fetchStockPrice(symbol: string): Promise<number> {
  try {
    const response = await fetch(
      `${CORS_PROXY}https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.chart?.result?.[0]?.meta?.regularMarketPrice) {
      throw new Error('Invalid data format from Yahoo Finance API');
    }
    const price = data.chart.result[0].meta.regularMarketPrice;
    return price;
  } catch (error) {
    console.error('Error fetching stock price:', error);
    throw error;
  }
}

export async function fetchHistoricalPrice(symbol: string, date: Date): Promise<number | null> {
  try {
    // If the date is in the future, return null
    if (date > new Date()) {
      return null;
    }

    // Convert date to Unix timestamp (seconds)
    const timestamp = Math.floor(date.getTime() / 1000);
    
    const response = await fetch(
      `${CORS_PROXY}https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${timestamp}&period2=${timestamp + 86400}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check if we have valid data
    if (data.chart?.result?.[0]) {
      const result = data.chart.result[0];
      
      // Try to get closing price
      const quotes = result.indicators.quote[0];
      if (quotes.close?.[0] !== null && quotes.close?.[0] !== undefined) {
        return quotes.close[0];
      }
      
      // Try to get adjusted close price
      const adjClose = result.indicators?.adjclose?.[0]?.adjclose?.[0];
      if (adjClose !== null && adjClose !== undefined) {
        return adjClose;
      }
      
      // Try to get regular market price
      if (result.meta?.regularMarketPrice) {
        return result.meta.regularMarketPrice;
      }
    }
    
    throw new Error('No price data available for this date');
  } catch (error) {
    console.error('Error fetching historical price:', error);
    throw error;
  }
} 