import { RSUGrant, VestingEvent } from '../types/rsu';
import { addMonths } from 'date-fns';

export function generateVestingSchedule(
  grantDate: Date,
  totalShares: number,
  vestingPeriodYears: number = 4,
  cliffMonths: number = 12,
  vestingFrequencyMonths: number = 1
): VestingEvent[] {
  const vestingEvents: VestingEvent[] = [];
  const totalVestingMonths = vestingPeriodYears * 12;
  
  // Calculate total vesting events based on whether there's a cliff
  const totalVestingEvents = cliffMonths > 0
    ? Math.floor((totalVestingMonths - cliffMonths) / vestingFrequencyMonths) + 1 // +1 for cliff
    : Math.ceil(totalVestingMonths / vestingFrequencyMonths); // No cliff, just divide total months by frequency
  
  const sharesPerVesting = Math.floor(totalShares / totalVestingEvents);
  const remainingShares = totalShares - (sharesPerVesting * totalVestingEvents);
  
  // Add cliff vesting event if there is a cliff
  if (cliffMonths > 0) {
    vestingEvents.push({
      date: addMonths(grantDate, cliffMonths),
      quantity: sharesPerVesting + remainingShares, // Add any remaining shares to cliff vest
    });
  }

  // Add regular vesting events
  const startMonth = cliffMonths > 0 ? cliffMonths + vestingFrequencyMonths : vestingFrequencyMonths;
  for (
    let month = startMonth;
    month <= totalVestingMonths;
    month += vestingFrequencyMonths
  ) {
    vestingEvents.push({
      date: addMonths(grantDate, month),
      quantity: cliffMonths > 0 ? sharesPerVesting : (
        // If no cliff, add remaining shares to the last vest
        month === totalVestingMonths ? sharesPerVesting + remainingShares : sharesPerVesting
      ),
    });
  }

  return vestingEvents;
}

export function calculateTotalVestedShares(grant: RSUGrant, asOfDate: Date = new Date()): number {
  return grant.vestingSchedule
    .filter(event => event.date <= asOfDate)
    .reduce((total, event) => total + event.quantity, 0);
}

export function calculateTotalValue(grant: RSUGrant, currentPrice: number): number {
  return grant.vestingSchedule.reduce((total, event) => {
    return total + (event.quantity * (event.price || currentPrice));
  }, 0);
} 