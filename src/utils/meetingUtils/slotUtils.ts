export function parseTimeframe(timeframe: string): { startDate: string; endDate: string } {
  console.log(`📅 [TIMEFRAME] Parsing: ${timeframe}`);
  
  const now = new Date();
  const startOfWorkingDay = 9; // 9 AM
  const endOfWorkingDay = 17; // 5 PM
  
  let result;
  
  switch (timeframe.toLowerCase()) {
    case 'today':
      result = {
        startDate: new Date(now.setHours(startOfWorkingDay, 0, 0, 0)).toISOString(),
        endDate: new Date(now.setHours(endOfWorkingDay, 0, 0, 0)).toISOString()
      };
      break;
    
    case 'tomorrow':
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      result = {
        startDate: new Date(tomorrow.setHours(startOfWorkingDay, 0, 0, 0)).toISOString(),
        endDate: new Date(tomorrow.setHours(endOfWorkingDay, 0, 0, 0)).toISOString()
      };
      break;
    
    case 'this week':
    default:
      // Next 5 working days
      const endDate = new Date(now);
      endDate.setDate(now.getDate() + 5);
      result = {
        startDate: new Date(now.setHours(startOfWorkingDay, 0, 0, 0)).toISOString(),
        endDate: new Date(endDate.setHours(endOfWorkingDay, 0, 0, 0)).toISOString()
      };
      break;
  }
  
  console.log(`✅ [TIMEFRAME] Parsed result:`, result);
  return result;
}

export function findAvailableSlots(busySlots: any[], startDate: string, endDate: string, durationMinutes: number) {
  console.log(`🎯 [SLOTS] Finding available slots`);
  console.log(`🎯 [SLOTS DEBUG] Input:`, {
    busySlotsCount: busySlots.length,
    startDate,
    endDate,
    durationMinutes
  });
  
  const slots: { start: string; end: string }[] = [];
  const duration = durationMinutes * 60 * 1000; // Convert to milliseconds
  const slotGap = 15 * 60 * 1000; // 15-minute gaps between meetings
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  console.log(`🎯 [SLOTS] Time range:`, {
    start: start.toISOString(),
    end: end.toISOString(),
    durationMs: duration
  });
  
  // Generate potential slots every 30 minutes during working hours
  let currentTime = new Date(start);
  let checkedSlots = 0;
  
  while (currentTime < end) {
    const slotEnd = new Date(currentTime.getTime() + duration);
    checkedSlots++;
    
    // Check if this slot conflicts with any busy time
    const hasConflict = busySlots.some(busy => {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      
      return (currentTime < busyEnd && slotEnd > busyStart);
    });
    
    if (!hasConflict && slotEnd <= end) {
      slots.push({
        start: currentTime.toISOString(),
        end: slotEnd.toISOString()
      });
      console.log(`✅ [SLOTS] Found available slot ${slots.length}: ${currentTime.toISOString()} - ${slotEnd.toISOString()}`);
    } else if (hasConflict) {
      console.log(`❌ [SLOTS] Slot ${checkedSlots} has conflict: ${currentTime.toISOString()} - ${slotEnd.toISOString()}`);
    }
    
    // Move to next potential slot (30-minute intervals)
    currentTime = new Date(currentTime.getTime() + 30 * 60 * 1000);
  }
  
  const result = slots.slice(0, 6); // Return max 6 slots for better UX
  console.log(`🎯 [SLOTS] Final result: ${result.length} available slots out of ${checkedSlots} checked`);
  return result;
}

