
export const getPriorityOrder = (priority: 'high' | 'medium' | 'low'): number => {
  switch (priority) {
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default:
      // This case should ideally not be reached if Zod validation is correct
      console.warn(`Unknown priority value: ${priority}. Defaulting to 99.`);
      return 99;
  }
};