import React, { useState, useEffect } from 'react';
import { RSUGrant, VestingEvent } from '../types/rsu';
import { generateVestingSchedule, calculateTotalVestedShares, calculateTotalValue } from '../utils/rsuCalculations';
import { fetchStockPrice, fetchHistoricalPrice } from '../utils/stockPrices';
import { format } from 'date-fns';

const VESTING_FREQUENCIES = [
  { value: 1, label: 'Monthly' },
  { value: 3, label: 'Quarterly' },
  { value: 6, label: 'Semi-annually' },
  { value: 12, label: 'Annually' },
];

interface GrantFormData {
  grantDate: string;
  quantity: string;
  grantPrice: string;
  symbol: string;
  vestingYears: string;
  cliffMonths: string;
  vestingFrequencyMonths: string;
}

const defaultFormData: GrantFormData = {
  grantDate: '',
  quantity: '',
  grantPrice: '',
  symbol: '',
  vestingYears: '4',
  cliffMonths: '12',
  vestingFrequencyMonths: '1'
};

const RSUCalculator: React.FC = () => {
  const [grants, setGrants] = useState<RSUGrant[]>([]);
  const [formData, setFormData] = useState<GrantFormData>(defaultFormData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddGrantModal, setShowAddGrantModal] = useState(false);
  const [hideVested, setHideVested] = useState(false);

  // Function to update vest prices for a grant
  const updateVestPrices = async (grant: RSUGrant): Promise<RSUGrant> => {
    try {
      // Fetch current price first
      const currentPrice = await fetchStockPrice(grant.symbol);
      
      // Update vest prices
      const updatedSchedule = await Promise.all(
        grant.vestingSchedule.map(async (event) => {
          const isVested = event.date <= new Date();
          let price: number | undefined;
          let priceError: string | undefined;
          
          try {
            if (isVested) {
              // For vested shares, try to get historical price
              const historicalPrice = await fetchHistoricalPrice(grant.symbol, event.date);
              price = historicalPrice ?? undefined;
            } else {
              // For unvested shares, use current price
              price = currentPrice;
            }
          } catch (error) {
            console.error('Error fetching price for vest date:', event.date, error);
            priceError = 'Failed to fetch price';
          }

          return {
            ...event,
            price,
            priceError,
            value: event.quantity * (price || grant.grantPrice)
          };
        })
      );

      return {
        ...grant,
        currentPrice,
        vestingSchedule: updatedSchedule
      };
    } catch (error) {
      console.error('Error updating vest prices:', error);
      return {
        ...grant,
        priceError: 'Failed to fetch prices'
      };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const newGrant: RSUGrant = {
        grantDate: new Date(formData.grantDate),
        quantity: Number(formData.quantity),
        grantPrice: Number(formData.grantPrice),
        symbol: formData.symbol.toUpperCase(),
        vestingSchedule: generateVestingSchedule(
          new Date(formData.grantDate),
          Number(formData.quantity),
          Number(formData.vestingYears),
          Number(formData.cliffMonths),
          Number(formData.vestingFrequencyMonths)
        )
      };

      // Fetch prices and update the grant
      const updatedGrant = await updateVestPrices(newGrant);
      setGrants(prevGrants => [...prevGrants, updatedGrant]);
      setFormData(defaultFormData);
      setShowAddGrantModal(false);
    } catch (error) {
      setError('Error fetching stock prices. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Periodically update prices for all grants
  useEffect(() => {
    const updateAllGrants = async () => {
      const updatedGrants = await Promise.all(
        grants.map(updateVestPrices)
      );
      setGrants(updatedGrants);
    };

    const interval = setInterval(updateAllGrants, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [grants]);

  // Get all vesting events from all grants
  const allVestingEvents = grants.flatMap(grant => 
    grant.vestingSchedule.map(event => ({
      ...event,
      symbol: grant.symbol,
      grantPrice: grant.grantPrice,
      currentPrice: grant.currentPrice
    }))
  ).sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div className="app-container">
      <h1 className="app-title">
        <span className="highlight text-orange-500">rsu</span>
        <span className="text-gray-400">.calc</span>
      </h1>
      
      {error && (
        <div className="bg-red-900/20 border border-red-500/20 text-red-400 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {/* Grants Summary Table */}
      <div className="card p-6 mb-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-light tracking-tight">RSU Grants</h2>
          <button
            onClick={() => setShowAddGrantModal(true)}
            className="btn-primary"
          >
            Add Grant
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Grant Date</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Grant Price</th>
                <th className="text-right">Current Price</th>
                <th className="text-right">Vested Shares</th>
                <th className="text-right">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant, index) => {
                const vestedShares = calculateTotalVestedShares(grant);
                const totalValue = calculateTotalValue(grant, grant.currentPrice || grant.grantPrice);
                
                return (
                  <tr key={index}>
                    <td className="font-medium text-orange-500">{grant.symbol}</td>
                    <td>{format(grant.grantDate, 'MMM d, yyyy')}</td>
                    <td className="text-right">{grant.quantity.toLocaleString()}</td>
                    <td className="text-right">${grant.grantPrice.toFixed(2)}</td>
                    <td className="text-right">
                      ${(grant.currentPrice || grant.grantPrice).toFixed(2)}
                      {grant.priceError && <span className="text-red-400 ml-1">(failed)</span>}
                    </td>
                    <td className="text-right">{vestedShares.toLocaleString()}</td>
                    <td className="text-right">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Consolidated Vesting Schedule */}
      <div className="card p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-light tracking-tight">Vesting Schedule</h2>
          <button
            onClick={() => setHideVested(!hideVested)}
            className="btn-primary"
          >
            {hideVested ? 'Show vested' : 'Hide vested'}
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Vest Date</th>
                <th>Symbol</th>
                <th className="text-right">Shares</th>
                <th>Status</th>
                <th className="text-right">Stock Price</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {allVestingEvents
                .filter(event => !hideVested || event.date > new Date())
                .map((event, index) => {
                const isVested = event.date <= new Date();
                const stockPrice = isVested 
                  ? (event.price || event.grantPrice)
                  : (event.currentPrice || event.grantPrice);
                const value = event.quantity * stockPrice;
                const priceLabel = event.priceError 
                  ? `${stockPrice.toFixed(2)} (${event.priceError})`
                  : (isVested && !event.price) 
                    ? `${stockPrice.toFixed(2)} (grant)` 
                    : stockPrice.toFixed(2);

                return (
                  <tr key={index}>
                    <td>{format(event.date, 'MMM d, yyyy')}</td>
                    <td className="font-medium text-orange-500">{event.symbol}</td>
                    <td className="text-right">{event.quantity.toLocaleString()}</td>
                    <td>
                      <span className={`text-xs font-medium px-2 py-1 rounded ${
                        isVested 
                          ? 'bg-orange-500/20 text-orange-300'
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {isVested ? 'Vested' : 'Unvested'}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className={event.priceError ? 'text-red-400' : ''}>
                        ${priceLabel}
                      </span>
                    </td>
                    <td className="text-right">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Grant Modal */}
      {showAddGrantModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-light tracking-tight">Add New Grant</h2>
                <button
                  onClick={() => setShowAddGrantModal(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">
                      Stock Symbol
                      <input
                        type="text"
                        name="symbol"
                        value={formData.symbol}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                        placeholder="e.g., AAPL"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Grant Date
                      <input
                        type="date"
                        name="grantDate"
                        value={formData.grantDate}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Number of Shares
                      <input
                        type="number"
                        name="quantity"
                        value={formData.quantity}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                        min="1"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Grant Price ($)
                      <input
                        type="number"
                        name="grantPrice"
                        value={formData.grantPrice}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                        min="0.01"
                        step="0.01"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Vesting Years
                      <input
                        type="number"
                        name="vestingYears"
                        value={formData.vestingYears}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                        min="1"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Cliff Period (months)
                      <input
                        type="number"
                        name="cliffMonths"
                        value={formData.cliffMonths}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                        min="0"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Vesting Frequency
                      <select
                        name="vestingFrequencyMonths"
                        value={formData.vestingFrequencyMonths}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                      >
                        {VESTING_FREQUENCIES.map(freq => (
                          <option key={freq.value} value={freq.value}>
                            {freq.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={() => setShowAddGrantModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading}
                  >
                    {loading ? 'Adding...' : 'Add Grant'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RSUCalculator; 