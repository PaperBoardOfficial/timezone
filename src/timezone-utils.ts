/**
 * Server-side timezone utilities
 * 
 * Core Approach:
 * - UTC in Database: All dates are stored in UTC format
 * - Local Time in UI: Dates are converted to user's timezone for display
 */

import moment from 'moment-timezone';

// Default timezone as last resort
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Map of timezone abbreviations to IANA timezone identifiers
 * This is critical for properly interpreting timezone abbreviations from emails
 */
const TIMEZONE_ABBREVIATION_MAP: Record<string, string> = {
  // North America
  'ET': 'America/New_York',   // Eastern Time
  'EST': 'America/New_York',  // Eastern Standard Time
  'EDT': 'America/New_York',  // Eastern Daylight Time
  'EASTERN TIME': 'America/New_York', // Full name
  'EASTERN STANDARD TIME': 'America/New_York', // Full name
  'EASTERN DAYLIGHT TIME': 'America/New_York', // Full name
  
  'CT': 'America/Chicago',    // Central Time
  'CST': 'America/Chicago',   // Central Standard Time
  'CDT': 'America/Chicago',   // Central Daylight Time
  'CENTRAL TIME': 'America/Chicago', // Full name
  'CENTRAL STANDARD TIME': 'America/Chicago', // Full name
  'CENTRAL DAYLIGHT TIME': 'America/Chicago', // Full name
  
  'MT': 'America/Denver',     // Mountain Time
  'MST': 'America/Denver',    // Mountain Standard Time
  'MDT': 'America/Denver',    // Mountain Daylight Time
  'MOUNTAIN TIME': 'America/Denver', // Full name
  'MOUNTAIN STANDARD TIME': 'America/Denver', // Full name
  'MOUNTAIN DAYLIGHT TIME': 'America/Denver', // Full name
  
  'PT': 'America/Los_Angeles', // Pacific Time
  'PST': 'America/Los_Angeles', // Pacific Standard Time
  'PDT': 'America/Los_Angeles', // Pacific Daylight Time
  'PACIFIC TIME': 'America/Los_Angeles', // Full name
  'PACIFIC STANDARD TIME': 'America/Los_Angeles', // Full name
  'PACIFIC DAYLIGHT TIME': 'America/Los_Angeles', // Full name
  
  // Europe
  'GMT': 'Europe/London',     // Greenwich Mean Time
  'BST': 'Europe/London',     // British Summer Time
  'GREENWICH MEAN TIME': 'Europe/London', // Full name
  'BRITISH SUMMER TIME': 'Europe/London', // Full name
  
  'CET': 'Europe/Berlin',     // Central European Time
  'CEST': 'Europe/Berlin',    // Central European Summer Time
  'CENTRAL EUROPEAN TIME': 'Europe/Berlin', // Full name
  'CENTRAL EUROPEAN SUMMER TIME': 'Europe/Berlin', // Full name
  
  'EET': 'Europe/Kiev',       // Eastern European Time
  'EEST': 'Europe/Kiev',      // Eastern European Summer Time
  'EASTERN EUROPEAN TIME': 'Europe/Kiev', // Full name
  'EASTERN EUROPEAN SUMMER TIME': 'Europe/Kiev', // Full name
  
  // Asia
  'IST': 'Asia/Kolkata',      // Indian Standard Time
  'INDIAN STANDARD TIME': 'Asia/Kolkata', // Full name
  
  'JST': 'Asia/Tokyo',        // Japan Standard Time
  'JAPAN STANDARD TIME': 'Asia/Tokyo', // Full name
  
  // Australia
  'AEST': 'Australia/Sydney', // Australian Eastern Standard Time
  'AEDT': 'Australia/Sydney', // Australian Eastern Daylight Time
  'AUSTRALIAN EASTERN STANDARD TIME': 'Australia/Sydney', // Full name
  'AUSTRALIAN EASTERN DAYLIGHT TIME': 'Australia/Sydney', // Full name
};

/**
 * Convert a date to UTC for storage in the database
 * @param date Date to convert
 * @returns Date string in UTC format
 */
export function toUTC(date: Date | string | number): string {
  return moment(date).utc().format();
}

/**
 * Convert a date to a specific timezone
 * @param date Date to convert
 * @param timezone Timezone to convert to (accepts both IANA and abbreviations like "ET")
 * @returns Date string in the specified timezone
 */
export function toTimezone(date: Date | string | number, timezone: string): string {
  // First convert any timezone abbreviation to a full IANA identifier
  const ianaTimezone = convertTimezoneAbbreviation(timezone) || DEFAULT_TIMEZONE;
  
  // Then use the IANA timezone for the conversion
  return moment(date).tz(ianaTimezone).format();
}

/**
 * Convert a date from UTC to a specific timezone
 * @param utcDate Date in UTC
 * @param timezone Timezone to convert to (accepts both IANA and abbreviations like "ET")
 * @returns Date string in the specified timezone
 */
export function fromUTCToTimezone(utcDate: string, timezone: string): string {
  // First convert any timezone abbreviation to a full IANA identifier
  const ianaTimezone = convertTimezoneAbbreviation(timezone) || DEFAULT_TIMEZONE;
  
  // Then use the IANA timezone for the conversion
  return moment.utc(utcDate).tz(ianaTimezone).format();
}

/**
 * Convert a timezone abbreviation to a full IANA timezone identifier
 * @param abbreviation Timezone abbreviation (e.g., "ET", "PST", "EEST")
 * @returns IANA timezone identifier (e.g., "America/New_York", "America/Los_Angeles")
 */
export function convertTimezoneAbbreviation(abbreviation: string | null | undefined): string | null {
  if (!abbreviation) return null;
  
  // Normalize to uppercase for case-insensitive matching
  const normalizedAbbr = abbreviation.toUpperCase();
  
  // Return the mapped IANA timezone if it exists
  if (TIMEZONE_ABBREVIATION_MAP[normalizedAbbr]) {
    console.log(`Converted timezone abbreviation ${abbreviation} to ${TIMEZONE_ABBREVIATION_MAP[normalizedAbbr]}`);
    return TIMEZONE_ABBREVIATION_MAP[normalizedAbbr];
  }
  
  // Return the original input if no mapping exists (it might already be an IANA identifier)
  console.log(`No mapping found for timezone abbreviation ${abbreviation}, using as is`);
  return abbreviation;
}

/**
 * Check if a timezone is valid
 * @param timezone Timezone to check
 * @returns Whether the timezone is valid
 */
export function isValidTimezone(timezone: string | null | undefined): boolean {
  if (!timezone) return false;
  
  // First try to convert any abbreviation to a full IANA identifier
  const ianaTimezone = convertTimezoneAbbreviation(timezone);
  
  // Then check if it's a valid timezone
  // Add null check before passing to moment.tz.zone
  return ianaTimezone ? !!moment.tz.zone(ianaTimezone) : false;
}

/**
 * Format a date in UTC for consistent storage
 * @param date Date to format
 * @param format Format string
 * @returns Formatted date string in UTC
 */
export function formatUTC(date: Date | string | number, format: string = 'YYYY-MM-DD HH:mm:ss'): string {
  return moment.utc(date).format(format);
}

/**
 * Format a date in a specific timezone
 * @param date Date to format
 * @param timezone Timezone to format in (accepts both IANA and abbreviations like "ET")
 * @param format Format string
 * @returns Formatted date string in the specified timezone
 */
export function formatInTimezone(
  date: Date | string | number, 
  timezone: string, 
  format: string = 'YYYY-MM-DD HH:mm:ss'
): string {
  // First convert any timezone abbreviation to a full IANA identifier
  const ianaTimezone = convertTimezoneAbbreviation(timezone) || DEFAULT_TIMEZONE;
  
  // Then use the IANA timezone for the conversion
  return moment(date).tz(ianaTimezone).format(format);
}

/**
 * Get the current date and time in UTC
 * @returns Current date and time in UTC
 */
export function nowUTC(): string {
  return moment.utc().format();
}

/**
 * Debug function to log timezone conversion information
 * @param date Date to test
 * @param userTimezone User's timezone
 */
export function logTimezoneConversion(date: Date | string, userTimezone: string = DEFAULT_TIMEZONE): void {
  const localDate = new Date(date);
  const utcFormatted = toUTC(localDate);
  const userTzFormatted = toTimezone(localDate, userTimezone);
  
  console.group('Timezone Conversion Debug');
  console.log('Original Date:', localDate);
  console.log('UTC Formatted:', utcFormatted);
  console.log(`${userTimezone} Formatted:`, userTzFormatted);
  console.groupEnd();
}

/**
 * Helper function that normally converts null to undefined for TypeScript compatibility
 * 
 * IMPORTANT: This function has been UPDATED to preserve null values for sourceTimezone.
 * This is necessary because null indicates a local time in the user's timezone, which
 * has special semantic meaning in our application.
 * 
 * @param value Value that might be null or already undefined
 * @returns The original value, including null values (NOT converted to undefined)
 */
export function toUndefinable<T>(value: T | null | undefined): T | undefined | null {
  // MODIFIED: We now return null values as is, without converting to undefined
  // This is needed specifically for the sourceTimezone field where null has meaning
  return value;
}