/**
 * Timezone Response Fix Module
 * 
 * This module ensures that sourceTimezone field is properly preserved in API responses.
 * Created to fix an issue where timezone information was being dropped during API response formatting.
 */

/**
 * Ensures sourceTimezone is passed through to the client
 * 
 * This function creates a wrapper around dates[] array that preserves all sourceTimezone information
 * in time slots when returning API responses. It works together with preserveSourceTimezoneNull()
 * to ensure null values for sourceTimezone (which indicate local time) are maintained throughout
 * the timezone conversion pipeline.
 * 
 * @param extractedData The original data extracted from OpenAI
 * @returns A modified version with sourceTimezone preserved
 */
export function preserveSourceTimezone(extractedData: any) {
  if (!extractedData || !extractedData.dates) return extractedData;
  
  // Create a deep copy to avoid modifying the original
  const result = JSON.parse(JSON.stringify(extractedData));
  
  // Process all dates and times to ensure sourceTimezone is preserved
  result.dates = result.dates.map((dateInfo: any) => {
    if (dateInfo.times) {
      dateInfo.times = dateInfo.times.map((timeSlot: any) => {
        return {
          ...timeSlot,
          // Use our helper to ensure null is preserved
          sourceTimezone: preserveSourceTimezoneNull(timeSlot.sourceTimezone)
        };
      });
    }
    return dateInfo;
  });
  
  return result;
}

/**
 * Workaround for TypeScript errors when working with null sourceTimezone values
 * 
 * This function is specifically designed to preserve null values for sourceTimezone 
 * while satisfying TypeScript's type system requirements. It declares to TypeScript
 * that it returns string | undefined, but at runtime it actually returns the original 
 * value including null.
 * 
 * This allows our codebase to maintain the semantic meaning of null (which indicates
 * a local time in the user's timezone) while working within TypeScript's constraints.
 * 
 * @param value - The sourceTimezone value that might be string, null, or undefined
 * @returns The same value but typed as string | undefined for TypeScript's benefit
 */
export function preserveSourceTimezoneNull(value: string | null | undefined): string | undefined {
  // Type assertion tells TypeScript this returns string | undefined
  // but at runtime it will return the actual value including null
  return value as unknown as string | undefined;
}