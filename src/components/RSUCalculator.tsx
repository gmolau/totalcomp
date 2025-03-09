import React, { useState, useEffect } from 'react';
import { RSUGrant, VestingEvent, StockPriceEntry } from '../types/rsu';
import { generateVestingSchedule, calculateTotalVestedShares, calculateTotalValue } from '../utils/rsuCalculations';
import { fetchStockPrice, fetchHistoricalPrice } from '../utils/stockPrices';
import { format } from 'date-fns';

const VESTING_FREQUENCIES = [
  { value: 1, label: 'Monthly' },
  { value: 3, label: 'Quarterly' },
  { value: 6, label: 'Semi-annually' },
  { value: 12, label: 'Annually' },
];

const TIMEFRAMES = [
  { value: 6, label: '6 months' },
  { value: 12, label: '1 year' },
  { value: 24, label: '2 years' },
  { value: 36, label: '3 years' },
  { value: 48, label: '4 years' },
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

interface SalaryEntry {
  amount: number;
  paymentDay: number;
  startDate: Date;
  description: string;
  id: number;
  previousAmount?: number;  // The previous salary amount, if this is a change
  changeType: 'initial' | 'increase' | 'decrease';  // Type of salary entry
}

interface BonusEntry {
  id: number;
  percentage: number;
  paymentDate: Date;
  description: string;
  referenceSalaryId: number;  // The salary this bonus is based on
}

interface SalaryFormData {
  amount: string;
  paymentDay: string;
  startDate: string;
  description: string;
  previousSalaryId?: number;
  editingSalaryId?: number;  // Add this to track which salary we're editing
}

const defaultSalaryFormData: SalaryFormData = {
  amount: '',
  paymentDay: '1',
  startDate: '',
  description: 'Base Salary',
  editingSalaryId: undefined
};

interface BonusFormData {
  percentage: string;
  paymentDate: string;
  description: string;
  referenceSalaryId: string;  // Changed to string to match form value type
}

const defaultBonusFormData: BonusFormData = {
  percentage: '',
  paymentDate: '',
  description: 'Annual Performance Bonus',
  referenceSalaryId: ''  // Empty string for the select's initial state
};

type MenuItem = {
  id: string;
  label: string;
  icon: string; // We'll use simple text for now, could be replaced with proper icons
};

const MENU_ITEMS: MenuItem[] = [
  { id: 'income', label: 'Income Sources', icon: '💰' },
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'timeline', label: 'Timeline', icon: '📅' },
  { id: 'vesting', label: 'RSU Vesting', icon: '📈' },
];

interface IncomeSource {
  type: 'salary';
  amount: number;
  frequency: 'yearly' | 'monthly';
}

interface TimelineEntry {
  date: Date;
  source: string;
  amount: number;
  isVest?: boolean;
}

interface GroupedTimelineEntry {
  date: Date;
  sources: string[];
  amount: number;
}

type DisplayTimelineEntry = TimelineEntry | GroupedTimelineEntry;

interface StockPriceFormData {
  symbol: string;
  date: string;
  price: string;
  editingIndex?: number;  // Add this to track which entry we're editing
}

const defaultStockPriceFormData: StockPriceFormData = {
  symbol: '',
  date: format(new Date(new Date().setDate(new Date().getDate() + 1)), 'yyyy-MM-dd'),
  price: '',
  editingIndex: undefined
};

const RSUCalculator: React.FC = () => {
  const [grants, setGrants] = useState<RSUGrant[]>([]);
  const [salaries, setSalaries] = useState<SalaryEntry[]>([]);
  const [bonuses, setBonuses] = useState<BonusEntry[]>([]);
  const [formData, setFormData] = useState<GrantFormData>(defaultFormData);
  const [salaryFormData, setSalaryFormData] = useState<SalaryFormData>(defaultSalaryFormData);
  const [bonusFormData, setBonusFormData] = useState<BonusFormData>(defaultBonusFormData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddGrantModal, setShowAddGrantModal] = useState(false);
  const [showAddSalaryModal, setShowAddSalaryModal] = useState(false);
  const [showAddBonusModal, setShowAddBonusModal] = useState(false);
  const [hideVested, setHideVested] = useState(true);
  const [groupByMonth, setGroupByMonth] = useState(false);
  const [activeMenuItem, setActiveMenuItem] = useState<string>('income');
  const [baseSalary, setBaseSalary] = useState<number>(0);
  const [nextSalaryId, setNextSalaryId] = useState<number>(1);
  const [nextBonusId, setNextBonusId] = useState<number>(1);
  const [timeframe, setTimeframe] = useState<number>(24);
  const [timelineStartDate, setTimelineStartDate] = useState<Date>(new Date());
  const [timelineEndDate, setTimelineEndDate] = useState<Date>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 12);
    return date;
  });
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [stockPrices, setStockPrices] = useState<StockPriceEntry[]>([]);
  const [stockPriceFormData, setStockPriceFormData] = useState<StockPriceFormData>(defaultStockPriceFormData);
  const [showAddStockPriceModal, setShowAddStockPriceModal] = useState(false);

  // Function to update vest prices for a grant
  const updateVestPrices = async (grant: RSUGrant): Promise<RSUGrant> => {
    try {
      // Fetch current price first
      const currentPrice = await fetchStockPrice(grant.symbol);
      
      // Update stock prices table with current price
      setStockPrices(prev => {
        // Remove any existing current price entries for this symbol
        const filtered = prev.filter(p => !(p.symbol === grant.symbol && p.isCurrentPrice));
        // Add new current price entry
        return [...filtered, {
          symbol: grant.symbol,
          date: new Date(),
          price: currentPrice,
          isCurrentPrice: true
        }];
      });
      
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

  const handleSalarySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newAmount = Number(salaryFormData.amount);
    
    if (salaryFormData.editingSalaryId) {
      // We're editing an existing salary
      setSalaries(prev => prev.map(salary => 
        salary.id === salaryFormData.editingSalaryId
          ? {
              ...salary,
              amount: newAmount,
              paymentDay: Number(salaryFormData.paymentDay),
              startDate: new Date(salaryFormData.startDate),
              description: salaryFormData.description
            }
          : salary
      ));
    } else {
      // We're creating a new salary
      const previousSalary = salaryFormData.previousSalaryId 
        ? salaries.find(s => s.id === salaryFormData.previousSalaryId)
        : salaries.length > 0 ? salaries[salaries.length - 1] : null;
      
      const newSalary: SalaryEntry = {
        id: nextSalaryId,
        amount: newAmount,
        paymentDay: Number(salaryFormData.paymentDay),
        startDate: new Date(salaryFormData.startDate),
        description: salaryFormData.description,
        changeType: previousSalary 
          ? (newAmount > previousSalary.amount ? 'increase' : 'decrease')
          : 'initial',
        previousAmount: previousSalary?.amount
      };

      setSalaries(prev => [...prev, newSalary]);
      setNextSalaryId(prev => prev + 1);
    }

    setSalaryFormData(defaultSalaryFormData);
    setShowAddSalaryModal(false);
  };

  const handleSalaryInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSalaryFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleBonusInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setBonusFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleBonusSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const referenceSalary = salaries.find(s => s.id === Number(bonusFormData.referenceSalaryId));
    if (!referenceSalary) return;

    const newBonus: BonusEntry = {
      id: nextBonusId,
      percentage: Number(bonusFormData.percentage),
      paymentDate: new Date(bonusFormData.paymentDate),
      description: bonusFormData.description,
      referenceSalaryId: Number(bonusFormData.referenceSalaryId)
    };

    setBonuses(prev => [...prev, newBonus]);
    setNextBonusId(prev => prev + 1);
    setBonusFormData(defaultBonusFormData);
    setShowAddBonusModal(false);
  };

  const handleSalaryIncrease = (salaryId: number) => {
    const salary = salaries.find(s => s.id === salaryId);
    if (!salary) return;

    setSalaryFormData({
      amount: '',  // Leave empty for user to enter new amount
      paymentDay: salary.paymentDay.toString(),
      startDate: '',  // Leave empty for user to enter new start date
      description: salary.description,
      previousSalaryId: salary.id,  // Store the reference to the previous salary
      editingSalaryId: undefined  // Make sure we're not in edit mode
    });
    setShowAddSalaryModal(true);
  };

  const handleSalaryDelete = (salaryId: number) => {
    setSalaries(prev => prev.filter(s => s.id !== salaryId));
  };

  const handleSalaryEdit = (salary: SalaryEntry) => {
    setSalaryFormData({
      amount: salary.amount.toString(),
      paymentDay: salary.paymentDay.toString(),
      startDate: format(salary.startDate, 'yyyy-MM-dd'),
      description: salary.description,
      editingSalaryId: salary.id
    });
    setShowAddSalaryModal(true);
  };

  const handleBonusDelete = (bonusId: number) => {
    setBonuses(prev => prev.filter(b => b.id !== bonusId));
  };

  const handleBonusEdit = (bonus: BonusEntry) => {
    setBonusFormData({
      percentage: bonus.percentage.toString(),
      paymentDate: format(bonus.paymentDate, 'yyyy-MM-dd'),
      description: bonus.description,
      referenceSalaryId: bonus.referenceSalaryId.toString(),
    });
    setShowAddBonusModal(true);
  };

  const handleGrantDelete = (grantIndex: number) => {
    setGrants(prev => prev.filter((_, index) => index !== grantIndex));
  };

  const handleGrantEdit = (grant: RSUGrant) => {
    setFormData({
      grantDate: format(grant.grantDate, 'yyyy-MM-dd'),
      quantity: grant.quantity.toString(),
      grantPrice: grant.grantPrice.toString(),
      symbol: grant.symbol,
      vestingYears: '4',
      cliffMonths: '12',
      vestingFrequencyMonths: '1'
    });
    setShowAddGrantModal(true);
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

  // Function to get the price for a given symbol and date
  const getPriceForDate = (symbol: string, date: Date): number | undefined => {
    // Get all prices for this symbol
    const symbolPrices = stockPrices
      .filter(p => p.symbol === symbol)
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    // Find the most recent price entry before or on the given date
    const priceEntry = symbolPrices.find(p => p.date <= date);
    return priceEntry?.price;
  };

  const renderContent = () => {
    switch (activeMenuItem) {
      case 'dashboard':
        // Get current date and available years
        const now = new Date();
        const currentYear = now.getFullYear();

        // Find earliest and latest years from all data
        const allYears = [
          ...salaries.map(s => s.startDate.getFullYear()),
          ...bonuses.map(b => b.paymentDate.getFullYear()),
          ...allVestingEvents.map(v => v.date.getFullYear())
        ];
        
        const earliestYear = Math.min(...allYears, currentYear);
        const latestYear = Math.max(...allYears, currentYear);
        
        // Generate array of all years between earliest and latest
        const availableYears = Array.from(
          { length: latestYear - earliestYear + 1 },
          (_, i) => latestYear - i
        );

        // Calculate values for selected year
        const selectedYearSalary = [...salaries]
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
          .find(salary => salary.startDate <= new Date(selectedYear, 11, 31));

        const selectedYearVests = allVestingEvents
          .filter(vest => vest.date.getFullYear() === selectedYear)
          .reduce((total, vest) => {
            const stockPrice = vest.date <= now 
              ? (vest.price || vest.grantPrice)
              : (vest.currentPrice || vest.grantPrice);
            return total + (vest.quantity * stockPrice);
          }, 0);

        const selectedYearBonuses = bonuses
          .filter(bonus => bonus.paymentDate.getFullYear() === selectedYear)
          .reduce((total, bonus) => {
            const referenceSalary = salaries.find(s => s.id === bonus.referenceSalaryId);
            return total + (referenceSalary ? (referenceSalary.amount * bonus.percentage / 100) : 0);
          }, 0);

        // Calculate values for previous year
        const previousYear = selectedYear - 1;
        const previousYearSalary = [...salaries]
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
          .find(salary => salary.startDate <= new Date(previousYear, 11, 31));

        const previousYearVests = allVestingEvents
          .filter(vest => vest.date.getFullYear() === previousYear)
          .reduce((total, vest) => {
            const stockPrice = vest.date <= now 
              ? (vest.price || vest.grantPrice)
              : (vest.currentPrice || vest.grantPrice);
            return total + (vest.quantity * stockPrice);
          }, 0);

        const previousYearBonuses = bonuses
          .filter(bonus => bonus.paymentDate.getFullYear() === previousYear)
          .reduce((total, bonus) => {
            const referenceSalary = salaries.find(s => s.id === bonus.referenceSalaryId);
            return total + (referenceSalary ? (referenceSalary.amount * bonus.percentage / 100) : 0);
          }, 0);

        // Calculate year-over-year changes
        const baseSalaryAmount = selectedYearSalary?.amount || 0;
        const previousBaseSalaryAmount = previousYearSalary?.amount || 0;
        const salaryChange = previousBaseSalaryAmount ? ((baseSalaryAmount - previousBaseSalaryAmount) / previousBaseSalaryAmount * 100) : 0;
        
        const vestsChange = previousYearVests ? ((selectedYearVests - previousYearVests) / previousYearVests * 100) : 0;
        const bonusesChange = previousYearBonuses ? ((selectedYearBonuses - previousYearBonuses) / previousYearBonuses * 100) : 0;
        
        const totalCompensation = baseSalaryAmount + selectedYearVests + selectedYearBonuses;
        const previousTotalCompensation = previousBaseSalaryAmount + previousYearVests + previousYearBonuses;
        const totalChange = previousTotalCompensation ? ((totalCompensation - previousTotalCompensation) / previousTotalCompensation * 100) : 0;

        return (
          <div className="space-y-6">
            <div className="flex justify-end">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="btn-primary py-2 px-4 min-w-[120px] appearance-none bg-no-repeat bg-[right_12px_center] bg-[length:16px] bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQgNkw4IDEwTDEyIDYiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4K')]"
              >
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            <div className="card p-6">
              <h2 className="text-2xl font-light tracking-tight mb-6">Total Annual Compensation</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white/5 rounded-lg p-6 space-y-2">
                  <div className="text-gray-400 text-sm">Base Salary</div>
                  <div className="text-2xl font-medium">${Math.round(baseSalaryAmount).toLocaleString()}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-400">
                      {selectedYearSalary?.description || 'No salary data'}
                    </div>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-6 space-y-2">
                  <div className="text-gray-400 text-sm">RSU Vesting Value</div>
                  <div className="text-2xl font-medium">${Math.round(selectedYearVests).toLocaleString()}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-400">Vesting in {selectedYear}</div>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-6 space-y-2">
                  <div className="text-gray-400 text-sm">Bonuses</div>
                  <div className="text-2xl font-medium">${Math.round(selectedYearBonuses).toLocaleString()}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-400">Expected in {selectedYear}</div>
                  </div>
                </div>
                <div className="bg-orange-500/20 rounded-lg p-6 space-y-2">
                  <div className="text-orange-300 text-sm">Total Compensation</div>
                  <div className="text-2xl font-medium text-orange-300">${Math.round(totalCompensation).toLocaleString()}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-orange-300/70">Annual Total for {selectedYear}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-6">
              <h2 className="text-2xl font-light tracking-tight mb-6">Year-over-Year Changes</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white/5 rounded-lg p-6 space-y-2">
                  <div className="text-gray-400 text-sm">Base Salary Change</div>
                  <div className={`text-2xl font-medium ${salaryChange > 0 ? 'text-green-400' : salaryChange < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {salaryChange > 0 ? '+' : ''}{salaryChange.toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-400">vs {selectedYear - 1}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-6 space-y-2">
                  <div className="text-gray-400 text-sm">RSU Vesting Change</div>
                  <div className={`text-2xl font-medium ${vestsChange > 0 ? 'text-green-400' : vestsChange < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {vestsChange > 0 ? '+' : ''}{vestsChange.toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-400">vs {selectedYear - 1}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-6 space-y-2">
                  <div className="text-gray-400 text-sm">Bonuses Change</div>
                  <div className={`text-2xl font-medium ${bonusesChange > 0 ? 'text-green-400' : bonusesChange < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {bonusesChange > 0 ? '+' : ''}{bonusesChange.toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-400">vs {selectedYear - 1}</div>
                </div>
                <div className="bg-orange-500/20 rounded-lg p-6 space-y-2">
                  <div className="text-orange-300 text-sm">Total Change</div>
                  <div className={`text-2xl font-medium ${totalChange > 0 ? 'text-green-400' : totalChange < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {totalChange > 0 ? '+' : ''}{totalChange.toFixed(1)}%
                  </div>
                  <div className="text-sm text-orange-300/70">vs {selectedYear - 1}</div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'income':
        return (
          <div className="space-y-6">
            <div className="card p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">Salary</h2>
                <button
                  onClick={() => setShowAddSalaryModal(true)}
                  className="btn-primary"
                >
                  Add Salary
                </button>
              </div>
              {salaries.length > 0 ? (
                <div className="table-scroll-wrapper">
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Start Date</th>
                          <th className="text-right">Payment Day</th>
                          <th className="text-right">Annual Amount</th>
                          <th className="text-right">Monthly Amount</th>
                          <th>Change</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...salaries]
                          .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
                          .map((salary, index, sortedSalaries) => {
                          const previousSalary = index > 0 ? sortedSalaries[index - 1] : null;
                          const changePercent = previousSalary
                            ? ((salary.amount - previousSalary.amount) / previousSalary.amount) * 100 
                            : 0;
                          
                          return (
                            <tr key={index}>
                              <td>{salary.description}</td>
                              <td>{format(salary.startDate, 'MMM d, yyyy')}</td>
                              <td className="text-right">{salary.paymentDay}</td>
                              <td className="text-right">${salary.amount.toLocaleString()}</td>
                              <td className="text-right">${(salary.amount / 12).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td>
                                <span className={`status-badge ${
                                  index === 0
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : changePercent > 0
                                    ? 'bg-green-500/20 text-green-300'
                                    : 'bg-red-500/20 text-red-300'
                                }`}>
                                  {index === 0 ? 'Initial' : (
                                    <>
                                      {changePercent > 0 ? '+' : ''}
                                      {changePercent.toFixed(1)}%
                                    </>
                                  )}
                                </span>
                              </td>
                              <td className="text-right space-x-3">
                                <button
                                  onClick={() => handleSalaryEdit(salary)}
                                  className="text-sm text-orange-500 hover:text-orange-400"
                                  title="Edit"
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={() => handleSalaryDelete(salary.id)}
                                  className="text-sm text-red-500 hover:text-red-400"
                                  title="Delete"
                                >
                                  🗑
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-center py-8">
                  No salary entries added yet
                </div>
              )}
              {salaries.length > 0 && (
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => {
                      const latestSalary = [...salaries].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
                      handleSalaryIncrease(latestSalary.id);
                    }}
                    className="text-sm text-orange-500 hover:text-orange-400"
                  >
                    Record Change
                  </button>
                </div>
              )}
            </div>

            <div className="card p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">Bonuses</h2>
                <button
                  onClick={() => setShowAddBonusModal(true)}
                  className="btn-primary"
                >
                  Add Bonus
                </button>
              </div>
              {bonuses.length > 0 ? (
                <div className="table-scroll-wrapper">
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th className="text-left">Description</th>
                          <th>Payment Date</th>
                          <th className="text-right">Percentage</th>
                          <th className="text-right">Amount</th>
                          <th>Reference Salary</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...bonuses]
                          .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())
                          .map((bonus, index) => {
                            const referenceSalary = salaries.find(s => s.id === bonus.referenceSalaryId);
                            const bonusAmount = referenceSalary ? (referenceSalary.amount * bonus.percentage / 100) : 0;
                            
                            return (
                              <tr key={index}>
                                <td className="text-left">{bonus.description}</td>
                                <td>{format(bonus.paymentDate, 'MMM d, yyyy')}</td>
                                <td className="text-right">{bonus.percentage}%</td>
                                <td className="text-right">${bonusAmount.toLocaleString()}</td>
                                <td>
                                  <span className="status-badge bg-blue-500/20 text-blue-300">
                                    {referenceSalary?.description || 'Unknown'} (${referenceSalary?.amount.toLocaleString()})
                                  </span>
                                </td>
                                <td className="text-right space-x-3">
                                  <button
                                    onClick={() => handleBonusEdit(bonus)}
                                    className="text-sm text-orange-500 hover:text-orange-400"
                                    title="Edit"
                                  >
                                    ✎
                                  </button>
                                  <button
                                    onClick={() => handleBonusDelete(bonus.id)}
                                    className="text-sm text-red-500 hover:text-red-400"
                                    title="Delete"
                                  >
                                    🗑
                                  </button>
                                </td>
                              </tr>
                            );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-center py-8">
                  No bonus entries added yet
                </div>
              )}
            </div>

            <div className="card p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">RSU Grants</h2>
                <button
                  onClick={() => setShowAddGrantModal(true)}
                  className="btn-primary"
                >
                  Add Grant
                </button>
              </div>
              {grants.length > 0 ? (
                <div className="table-scroll-wrapper">
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Grant Date</th>
                          <th className="text-right">Total Shares</th>
                          <th className="text-right">Grant Price</th>
                          <th className="text-right">Current Price</th>
                          <th className="text-right">Total Value</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grants.map((grant, index) => {
                          const totalValue = grant.vestingSchedule.reduce((total, vest) => {
                            const isVested = vest.date <= new Date();
                            const priceToUse = isVested 
                              ? (vest.price || grant.grantPrice)
                              : (getPriceForDate(grant.symbol, vest.date) || grant.currentPrice || grant.grantPrice);
                            return total + (vest.quantity * priceToUse);
                          }, 0);
                          
                          return (
                            <tr key={index}>
                              <td className="font-medium text-orange-500">{grant.symbol}</td>
                              <td>{format(grant.grantDate, 'MMM d, yyyy')}</td>
                              <td className="text-right">{grant.quantity.toLocaleString()}</td>
                              <td className="text-right">${grant.grantPrice.toFixed(2)}</td>
                              <td className="text-right">
                                <span className={grant.priceError ? 'text-red-400' : ''}>
                                  ${(grant.currentPrice || grant.grantPrice).toFixed(2)}
                                  {grant.priceError && <span className="text-red-400 ml-1">(failed)</span>}
                                </span>
                              </td>
                              <td className="text-right">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="text-right space-x-3">
                                <button
                                  onClick={() => handleGrantEdit(grant)}
                                  className="text-sm text-orange-500 hover:text-orange-400"
                                  title="Edit"
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={() => handleGrantDelete(index)}
                                  className="text-sm text-red-500 hover:text-red-400"
                                  title="Delete"
                                >
                                  🗑
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-center py-8">
                  No RSU grants added yet
                </div>
              )}
            </div>

            <div className="card p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">Stock Growth</h2>
                <button
                  onClick={() => {
                    const uniqueSymbols = [...new Set(grants.map(g => g.symbol))];
                    setStockPriceFormData({
                      ...defaultStockPriceFormData,
                      symbol: uniqueSymbols.length === 1 ? uniqueSymbols[0] : ''
                    });
                    setShowAddStockPriceModal(true);
                  }}
                  className={`btn-primary ${grants.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={grants.length === 0}
                  title={grants.length === 0 ? 'Add an RSU grant first to enable price points' : ''}
                >
                  Add Price Point
                </button>
              </div>
              {stockPrices.length > 0 ? (
                <div className="table-scroll-wrapper">
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Date</th>
                          <th className="text-right">Price</th>
                          <th>Type</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...stockPrices]
                          .sort((a, b) => a.date.getTime() - b.date.getTime())
                          .map((entry, index) => (
                            <tr key={index}>
                              <td className="font-medium text-orange-500">{entry.symbol}</td>
                              <td>{format(entry.date, 'MMM d, yyyy')}</td>
                              <td className="text-right">${entry.price.toFixed(2)}</td>
                              <td>
                                <span className={`status-badge ${
                                  entry.isCurrentPrice
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : 'bg-orange-500/20 text-orange-300'
                                }`}>
                                  {entry.isCurrentPrice ? 'Current Price' : 'Price Point'}
                                </span>
                              </td>
                              <td className="text-right">
                                {!entry.isCurrentPrice && (
                                  <>
                                    <button
                                      onClick={() => handleStockPriceEdit(entry, index)}
                                      className="text-sm text-orange-500 hover:text-orange-400 mr-3"
                                      title="Edit"
                                    >
                                      ✎
                                    </button>
                                    <button
                                      onClick={() => handleStockPriceDelete(index)}
                                      className="text-sm text-red-500 hover:text-red-400"
                                      title="Delete"
                                    >
                                      🗑
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-center py-8">
                  No stock price entries yet
                </div>
              )}
            </div>
          </div>
        );
      
      case 'timeline':
        const monthlySalary = baseSalary / 12;
        const today = new Date();
        
        // Calculate number of months between start and end date
        const monthDiff = (timelineEndDate.getFullYear() - timelineStartDate.getFullYear()) * 12 + 
          (timelineEndDate.getMonth() - timelineStartDate.getMonth()) + 1;
        
        // Create timeline entries for both salary and RSU vests
        const timelineEntries = Array.from({ length: monthDiff }, (_, i) => {
          const date = new Date(
            timelineStartDate.getFullYear(),
            timelineStartDate.getMonth() + i,
            1
          );
          
          // Skip if date is beyond end date
          if (date > timelineEndDate) return [];
          
          // Find the active salary for this month (most recent salary before this date)
          const activeSalary = [...salaries]
            .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
            .find(salary => salary.startDate <= date);
          
          const salaryEntries = activeSalary ? [{
            date: new Date(date.getFullYear(), date.getMonth(), activeSalary.paymentDay),
            source: `Salary (${activeSalary.description})`,
            amount: activeSalary.amount / 12
          }] : [];
          
          // Find bonuses for this month
          const monthBonuses = bonuses.filter(bonus => 
            bonus.paymentDate.getMonth() === date.getMonth() &&
            bonus.paymentDate.getFullYear() === date.getFullYear()
          ).map(bonus => {
            const referenceSalary = salaries.find(s => s.id === bonus.referenceSalaryId);
            const bonusAmount = referenceSalary ? (referenceSalary.amount * bonus.percentage / 100) : 0;
            return {
              date: bonus.paymentDate,
              source: `Bonus (${bonus.description})`,
              amount: bonusAmount
            };
          });
          
          // Find RSU vests for this month
          const monthVests = allVestingEvents.filter(vest => 
            vest.date.getMonth() === date.getMonth() &&
            vest.date.getFullYear() === date.getFullYear()
          ).map(vest => ({
            date: vest.date,
            source: `RSU Vest (${vest.symbol})`,
            amount: vest.quantity * (vest.date <= new Date()
              ? (vest.price || vest.grantPrice)
              : (vest.currentPrice || vest.grantPrice)),
            isVest: true
          }));
          
          return [...salaryEntries, ...monthBonuses, ...monthVests];
        }).flat().sort((a, b) => a.date.getTime() - b.date.getTime());

        // Group entries by month if groupByMonth is enabled
        const displayEntries: DisplayTimelineEntry[] = groupByMonth
          ? Object.values(timelineEntries.reduce((acc, entry) => {
              const monthKey = format(entry.date, 'yyyy-MM');
              if (!acc[monthKey]) {
                acc[monthKey] = {
                  date: new Date(entry.date.getFullYear(), entry.date.getMonth(), 1),
                  sources: [],
                  amount: 0
                };
              }
              acc[monthKey].sources.push(entry.source);
              acc[monthKey].amount += entry.amount;
              return acc;
            }, {} as Record<string, GroupedTimelineEntry>))
          : timelineEntries;

        return (
          <div className="space-y-6">
            <div className="card p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">Income Timeline</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={format(timelineStartDate, 'yyyy-MM-dd')}
                      onChange={(e) => setTimelineStartDate(new Date(e.target.value))}
                      className="input-field py-1 px-3 text-sm min-w-[140px]"
                    />
                    <span className="text-gray-400">to</span>
                    <input
                      type="date"
                      value={format(timelineEndDate, 'yyyy-MM-dd')}
                      onChange={(e) => setTimelineEndDate(new Date(e.target.value))}
                      className="input-field py-1 px-3 text-sm min-w-[140px]"
                    />
                  </div>
                  <button
                    onClick={() => setGroupByMonth(!groupByMonth)}
                    className="btn-primary py-1 px-3 text-sm"
                  >
                    {groupByMonth ? 'Show all entries' : 'Group by month'}
                  </button>
                </div>
              </div>
              <div className="table-scroll-wrapper">
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Source</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayEntries.length > 0 ? (
                        displayEntries.map((entry, index) => (
                          <tr key={index}>
                            <td>{format(entry.date, groupByMonth ? 'MMM yyyy' : 'MMM d, yyyy')}</td>
                            <td>
                              {groupByMonth && 'sources' in entry ? (
                                <div className="flex flex-wrap gap-1">
                                  {Array.from(new Set(entry.sources)).map((source, i) => (
                                    <span key={i} className={`status-badge ${
                                      source.startsWith('Salary')
                                        ? 'bg-blue-500/20 text-blue-300'
                                        : 'bg-orange-500/20 text-orange-300'
                                    }`}>
                                      {source}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className={`status-badge ${
                                  ('source' in entry && entry.source.startsWith('Salary'))
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : 'bg-orange-500/20 text-orange-300'
                                }`}>
                                  {('source' in entry) ? entry.source : ''}
                                </span>
                              )}
                            </td>
                            <td className="text-right">
                              ${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="text-gray-400 text-center py-8">
                            No entries in selected date range
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td colSpan={2} className="text-right font-medium">Total:</td>
                        <td className="text-right font-medium">
                          ${displayEntries.reduce((total, entry) => total + entry.amount, 0
                          ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );

      case 'vesting':
        return (
          <div className="space-y-6">
            <div className="card p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">RSU Vesting Schedule</h2>
                <button
                  onClick={() => setHideVested(!hideVested)}
                  className="btn-primary"
                >
                  {hideVested ? 'Show vested' : 'Hide vested'}
                </button>
              </div>
              <div className="table-scroll-wrapper">
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Vest Date</th>
                        <th>Symbol</th>
                        <th className="text-right">Shares</th>
                        <th>Status</th>
                        <th className="text-right">Stock Price</th>
                        <th className="text-right">Change</th>
                        <th className="text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allVestingEvents
                        .filter(event => !hideVested || event.date > new Date())
                        .map((event, index) => {
                        const isVested = event.date <= new Date();
                        const grant = grants.find(g => g.symbol === event.symbol);
                        const stockPrice = isVested 
                          ? (event.price || event.grantPrice)
                          : (getPriceForDate(event.symbol, event.date) || event.currentPrice || event.grantPrice);
                        const value = event.quantity * stockPrice;
                        const priceLabel = event.priceError 
                          ? `${stockPrice.toFixed(2)} (${event.priceError})`
                          : (isVested && !event.price) 
                            ? `${stockPrice.toFixed(2)} (grant)` 
                            : (!isVested && getPriceForDate(event.symbol, event.date))
                              ? `${stockPrice.toFixed(2)} (projected)`
                              : stockPrice.toFixed(2);

                        // Calculate price change percentage
                        const priceChange = ((stockPrice - event.grantPrice) / event.grantPrice) * 100;
                        const changeColor = priceChange >= 0 ? 'text-green-400' : 'text-red-400';

                        return (
                          <tr key={index}>
                            <td>{format(event.date, 'MMM d, yyyy')}</td>
                            <td className="font-medium text-orange-500">{event.symbol}</td>
                            <td className="text-right">{event.quantity.toLocaleString()}</td>
                            <td>
                              <span className={`status-badge ${
                                isVested 
                                  ? 'bg-orange-500/20 text-orange-300'
                                  : 'bg-blue-500/20 text-blue-300'
                              }`}>
                                {isVested ? 'Vested' : 'Unvested'}
                              </span>
                            </td>
                            <td className="text-right">
                              <span className={event.priceError ? 'text-red-400' : (!isVested && getPriceForDate(event.symbol, event.date) ? 'text-orange-400' : '')}>
                                ${priceLabel}
                              </span>
                            </td>
                            <td className={`text-right ${changeColor}`}>
                              {priceChange > 0 ? '+' : ''}{priceChange.toFixed(2)}%
                            </td>
                            <td className="text-right">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  // Update handler for stock price form
  const handleStockPriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const entryDate = new Date(stockPriceFormData.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day for comparison

    if (entryDate <= today) {
      setError('Price points can only be set for future dates');
      return;
    }
    
    const newStockPrice: StockPriceEntry = {
      symbol: stockPriceFormData.symbol.toUpperCase(),
      date: entryDate,
      price: Number(stockPriceFormData.price),
      isCurrentPrice: false
    };

    setStockPrices(prev => {
      if (stockPriceFormData.editingIndex !== undefined) {
        // Update existing entry while preserving isCurrentPrice flag
        const updatedPrices = [...prev];
        const existingEntry = updatedPrices[stockPriceFormData.editingIndex];
        updatedPrices[stockPriceFormData.editingIndex] = {
          ...newStockPrice,
          isCurrentPrice: existingEntry.isCurrentPrice || false
        };
        return updatedPrices;
      } else {
        // Add new entry
        return [...prev, newStockPrice];
      }
    });

    setError(null);
    setStockPriceFormData(defaultStockPriceFormData);
    setShowAddStockPriceModal(false);
  };

  const handleStockPriceInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setStockPriceFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleStockPriceDelete = (index: number) => {
    setStockPrices(prev => prev.filter((_, i) => i !== index));
  };

  // Update handler for editing stock prices
  const handleStockPriceEdit = (entry: StockPriceEntry, index: number) => {
    setStockPriceFormData({
      symbol: entry.symbol,
      date: format(entry.date, 'yyyy-MM-dd'),
      price: entry.price.toString(),
      editingIndex: index
    });
    setShowAddStockPriceModal(true);
  };

  // Add min date validation to the date input in the stock price modal
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = format(tomorrow, 'yyyy-MM-dd');

  return (
    <div className="app-container">
      <h1 className="app-title">
        <span className="highlight text-orange-500">total</span>
        <span className="text-gray-400">.comp</span>
      </h1>
      
      {error && (
        <div className="bg-red-900/20 border border-red-500/20 text-red-400 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="flex gap-6">
        {/* Left Menu */}
        <div className="w-48 shrink-0">
          <div className="card p-2">
            {MENU_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveMenuItem(item.id)}
                className={`w-full text-left px-3 py-2 rounded transition-colors duration-200 flex items-center gap-2 ${
                  activeMenuItem === item.id
                    ? 'bg-orange-500/20 text-orange-300'
                    : 'hover:bg-white/5'
                }`}
              >
                <span className="w-5">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {renderContent()}
        </div>
      </div>

      {/* Add Salary Modal */}
      {showAddSalaryModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">
                  {salaryFormData.editingSalaryId ? 'Edit Salary' : (salaryFormData.previousSalaryId ? 'Salary Increase' : 'Add New Salary')}
                </h2>
                <button
                  onClick={() => setShowAddSalaryModal(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleSalarySubmit} className="space-y-4 sm:space-y-6">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">
                      Description
                      <input
                        type="text"
                        name="description"
                        value={salaryFormData.description}
                        onChange={handleSalaryInputChange}
                        className="input-field"
                        required
                        placeholder="e.g., Base Salary"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Start Date
                      <input
                        type="date"
                        name="startDate"
                        value={salaryFormData.startDate}
                        onChange={handleSalaryInputChange}
                        className="input-field"
                        required
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Annual Amount ($)
                      <input
                        type="number"
                        name="amount"
                        value={salaryFormData.amount}
                        onChange={handleSalaryInputChange}
                        className="input-field"
                        required
                        min="0"
                        step="1000"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Payment Day of Month
                      <input
                        type="number"
                        name="paymentDay"
                        value={salaryFormData.paymentDay}
                        onChange={handleSalaryInputChange}
                        className="input-field"
                        required
                        min="1"
                        max="31"
                      />
                    </label>
                  </div>
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={() => setShowAddSalaryModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                  >
                    {salaryFormData.editingSalaryId ? 'Save Changes' : (salaryFormData.previousSalaryId ? 'Add Increase' : 'Add Salary')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Bonus Modal */}
      {showAddBonusModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">Add New Bonus</h2>
                <button
                  onClick={() => setShowAddBonusModal(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleBonusSubmit} className="space-y-4 sm:space-y-6">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">
                      Description
                      <input
                        type="text"
                        name="description"
                        value={bonusFormData.description}
                        onChange={handleBonusInputChange}
                        className="input-field"
                        required
                        placeholder="e.g., Annual Performance Bonus 2023"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Payment Date
                      <input
                        type="date"
                        name="paymentDate"
                        value={bonusFormData.paymentDate}
                        onChange={handleBonusInputChange}
                        className="input-field"
                        required
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Percentage of Annual Salary
                      <input
                        type="number"
                        name="percentage"
                        value={bonusFormData.percentage}
                        onChange={handleBonusInputChange}
                        className="input-field"
                        required
                        min="0"
                        max="100"
                        step="0.1"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Reference Salary
                      <select
                        name="referenceSalaryId"
                        value={bonusFormData.referenceSalaryId}
                        onChange={handleBonusInputChange}
                        className="input-field"
                        required
                      >
                        <option value="">Select a salary</option>
                        {[...salaries]
                          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
                          .map(salary => (
                            <option key={salary.id} value={salary.id}>
                              {salary.description} (${salary.amount.toLocaleString()})
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={() => setShowAddBonusModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                  >
                    Add Bonus
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Grant Modal */}
      {showAddGrantModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">Add New Grant</h2>
                <button
                  onClick={() => setShowAddGrantModal(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
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

      {/* Add Stock Price Modal */}
      {showAddStockPriceModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-light tracking-tight">
                  {stockPriceFormData.editingIndex !== undefined ? 'Edit Stock Price' : 'Add Stock Price Point'}
                </h2>
                <button
                  onClick={() => setShowAddStockPriceModal(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleStockPriceSubmit} className="space-y-4 sm:space-y-6">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">
                      Stock Symbol
                      <select
                        name="symbol"
                        value={stockPriceFormData.symbol}
                        onChange={handleStockPriceInputChange}
                        className="input-field"
                        required
                      >
                        <option value="">Select a symbol</option>
                        {[...new Set(grants.map(g => g.symbol))].map(symbol => (
                          <option key={symbol} value={symbol}>
                            {symbol}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Date
                      <input
                        type="date"
                        name="date"
                        value={stockPriceFormData.date}
                        onChange={handleStockPriceInputChange}
                        className="input-field"
                        required
                        min={minDate}
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Price ($)
                      <input
                        type="number"
                        name="price"
                        value={stockPriceFormData.price}
                        onChange={handleStockPriceInputChange}
                        className="input-field"
                        required
                        min="0.01"
                        step="0.01"
                      />
                    </label>
                  </div>
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={() => setShowAddStockPriceModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                  >
                    {stockPriceFormData.editingIndex !== undefined ? 'Save Changes' : 'Add Price Point'}
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