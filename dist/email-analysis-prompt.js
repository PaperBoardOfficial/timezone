"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processSuggestedSlots = exports.dateExtractionSchema = exports.createSystemPrompt = exports.isLocalTimeByTimezone = exports.getCurrentDate = void 0;
/**
 * Email Analysis Prompt Module
 *
 * This module contains the system prompt and schema for OpenAI to extract
 * dates and times from email content for scheduling purposes.
 */
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const timezone_utils_1 = require("./timezone-utils");
const timezone_response_fix_1 = require("./timezone-response-fix");
// Get current date in YYYY-MM-DD format as fallback for the system prompt
const getCurrentDate = () => new Date().toISOString().split("T")[0];
exports.getCurrentDate = getCurrentDate;
/**
 * Helper function to check if a time should be treated as local based solely on sourceTimezone
 * This is a simplified approach: if sourceTimezone is null/undefined, treat time as local
 * If sourceTimezone exists, it means the time needs to be converted from that timezone
 *
 * @param sourceTimezone The source timezone from the email, if any
 * @returns true if time should be considered local time (no conversion needed),
 *          false if it needs conversion from source timezone
 */
const isLocalTimeByTimezone = (sourceTimezone) => {
    // FIXED: Correctly identify when a time should be treated as local time
    // A time is local when the sourceTimezone is null or undefined
    // This is more explicit and consistent with other parts of the codebase
    return sourceTimezone === null || sourceTimezone === undefined;
};
exports.isLocalTimeByTimezone = isLocalTimeByTimezone;
/**
 * Creates a system prompt for OpenAI to extract dates and times from text
 * Handles relative dates, specific weekdays, and various time formats
 * Returns structured JSON with standardized date and time information
 *
 * @param referenceDate Date to use for interpreting relative dates
 * @returns Formatted system prompt
 */
const createSystemPrompt = (referenceDate) => `Extract exact dates, times, meeting duration, and context from the text. Use ${referenceDate} as the reference date for relative dates (e.g., 'tomorrow,' 'next week').

Example 1: Specific Times
Input: "Hey Olena! I am available tomorrow at 3pm PST , and Wednesday at 2:30pm. Regards, Alice"
Output:
{
  "dates": [
    { 
      "date": "2025-03-12", 
      "weekday": "Wednesday",
      "times": [
        {
          "start": "15:00", 
          "end": "15:30", 
          "isSpecificTime": true,
          "isTimeRange": false,
          "isAllDay": false,
          "sourceTimezone": "America/Los_Angeles"
        }
      ] 
    },
    { 
      "date": "2025-03-05", 
      "weekday": "Wednesday",
      "times": [
        {
          "start": "14:30", 
          "end": "15:00", 
          "isSpecificTime": true,
          "isTimeRange": false,
          "isAllDay": false,
          "sourceTimezone": "America/Los_Angeles"
        }
      ] 
    }
  ],
  "event_title": "Olena <> Alice",
  "email_reply": "Thanks! I've booked [Selected Date and time]. Looking forward to our meeting!",
  "meeting_duration": null
}

Example 2: Time Ranges With Duration
Input: "Olena, I can meet after 3pm tomorrow for a 45-minute discussion. See you, Alice"
Output:
{
  "dates": [
    { 
      "date": "2025-03-08", 
      "weekday": "Saturday",
      "times": [
        {
          "start": "15:00", 
          "end": null, 
          "isSpecificTime": false,
          "isTimeRange": true,
          "isAllDay": false,
          "sourceTimezone": null
        }
      ] 
    }
  ],
  "event_title": "Olena <> Alice",
  "email_reply": "Perfect! I've scheduled our 45-minute meeting for [Selected Date and time]. Talk to you then!",
  "meeting_duration": 45
}

Example 3: All Day Availability
Input: "I am free the whole day on Friday. Just let me know what works for you for our 1-hour planning session."
Output:
{
  "dates": [
    { 
      "date": "2025-03-14", 
      "weekday": "Friday",
      "times": [
        {
          "start": "09:00", 
          "end": "18:00", 
          "isSpecificTime": false,
          "isTimeRange": true,
          "isAllDay": true,
          "sourceTimezone": null
        }
      ] 
    }
  ],
  "event_title": "Planning Session",
  "email_reply": "I've scheduled our 1-hour planning session for [Selected Date and time] on Friday. Looking forward to it!",
  "meeting_duration": 60
}

Rules:
1. Time Specification Types:
* For specific times (e.g., "at 3pm", "3pm tomorrow"):
** Set "isSpecificTime": true and "isTimeRange": false
** Set the start time exactly as mentioned
* For time ranges (e.g., "after 3pm", "between 10am and 2pm", "from 1pm to 4pm"):
** If the range duration is 30 minutes or less, treat it as a specific time:
    - Set "isSpecificTime": true and "isTimeRange": false
    - Use the start and end times accordingly
** Otherwise:
    - Set "isSpecificTime": false and "isTimeRange": true
** For "after X" scenarios: Set start to X and end to null
** For "between X and Y" or "from X to Y" scenarios: Set start to X and end to Y

2. Date Handling:
* Convert all relative dates (e.g., tomorrow, next week) to YYYY-MM-DD format using the current date.
* For weekday mentions (e.g., "Wednesday", "Friday"):
** Always use the next occurrence of that weekday from the reference date.
** If the reference date is the same weekday but the time has passed, return the weekday of the following week.
** If the phrase includes "next week" and a weekday (e.g., "Tuesday next week"), return the first instance of that weekday in the next calendar week, regardless of what day today is.
* Include the weekday name in the "weekday" field for validation.
* Verify that the extracted date matches the correct weekday. If there's a mismatch, correct the date.

3. Time Formatting:
* Convert all times to 24-hour HH:mm format.
* For mentions of "whole day", "all day", "entire day" availability, or when only a day is mentioned without specific times, create a time range covering standard business hours:
jsonCopy{
  "start": "09:00", 
  "end": "18:00", 
  "isSpecificTime": false,
  "isTimeRange": true,
  "isAllDay": true,
  "sourceTimezone": null
}

* IMPORTANT: When a specific day is mentioned without time information (e.g., "I'm available Thursday" or "Let's meet on Friday"), treat it as all-day availability with the above format.
* If multiple time ranges appear for a single date, store them separately in the times array.
* Maintain chronological order of dates in the output.

4. Timezone Handling:
* Detect and extract any explicit timezone references in the email, such as:
** Abbreviations: "PST", "EST", "CET", "EET", "UTC", etc.
** Full names or regions: "Pacific Time", "Eastern Time", "Europe/Kyiv", "GMT+2", etc.
* Normalize timezone references to their IANA form if available (e.g., "Pacific Time" → "America/Los_Angeles", "Kyiv" → "Europe/Kyiv", "ET" → "America/New_York").
* Disambiguate between Standard Time and Daylight/Summer Time:
** If ambiguous (e.g., “PST” in summer), prefer resolving based on the current date (${referenceDate}).
** Use current global rules for daylight saving time transitions (e.g., if it's April, “PST” should likely mean “PDT”).
* For each time extracted:
** If a timezone is explicitly mentioned near it, use that timezone.
** If no timezone is mentioned: Inherit the last timezone referenced earlier in the email.
** If no timezone is mentioned in the entire email, set "timezone": null and do not convert to UTC.
* If multiple times are mentioned with different timezones, associate the correct timezone with each respective time individually.

5. Language Processing:
* Parse implicit times like "morning" (9:00-12:00), "afternoon" (12:00-17:00), "evening" (17:00-20:00).
* Identify phrases like "all day", "whole day", "entire day" and set appropriate time ranges (e.g., 9:00-18:00).
* Handle expressions like "next few days", "this week", "next week" properly.

6. Meeting Duration Extraction:
* Extract any meeting duration mentioned in the email (e.g., "15-minute meeting", "45 mins call", "1 hour discussion", "30-minute chat").
* Convert all durations to minutes as an integer (e.g., "1 hour" = 60, "1.5 hour" = 90, "30 mins" = 30).
* If a specific duration is mentioned, include it in the meeting_duration field.
* If no duration is mentioned, set meeting_duration to null.

7. Response Generation:
* The "email_reply" should use placeholders [Selected Date and time], which will be replaced when the user confirms a slot.
* If a specific meeting duration was extracted, include it in the reply (e.g., "our 30-minute meeting").
* The reply should reflect that it is sent after a meeting has already been booked — never suggest new times or availability.
* Adapt the tone of the reply to match the original message style. Choose from variations such as:
** Casual/Friendly: "Great, [Name]! [Selected Date and time] is set. See you then!"
** Professional/Formal: "Thanks, [Name]. Our meeting is confirmed for [Selected Date and time]. Looking forward to it!"
** Enthusiastic: "Perfect, [Name]! [Selected Date and time] works great. Talk soon!"
** Concise: "Got it, [Name]. See you on [Selected Date and time]!"
* The response should feel natural and contextually appropriate based on the original email's wording.

8. Event Title Generation:
* Generate a concise and relevant event title based on the sender and context.
* The preferred format is [Name] <> [Name]
* Possible formats include:
** "Follow-up Meeting"
** "Quick Sync"
** "Next Steps Call"
* If sender's name is unavailable, default to a generic title.`;
exports.createSystemPrompt = createSystemPrompt;
/**
 * JSON schema for OpenAI's response format
 * Defines the structure for extracted dates and times
 */
exports.dateExtractionSchema = {
    name: "email_analysis",
    description: "Extracts dates and times from email content for scheduling",
    parameters: {
        type: "object",
        properties: {
            dates: {
                type: "array",
                description: "List of event dates with associated times.",
                items: {
                    type: "object",
                    properties: {
                        date: {
                            type: "string",
                            description: "The date of the event in YYYY-MM-DD format.",
                        },
                        weekday: {
                            type: "string",
                            description: "The weekday name for validation purposes.",
                        },
                        times: {
                            type: "array",
                            description: "List of possible time slots for the event.",
                            items: {
                                type: "object",
                                properties: {
                                    start: {
                                        type: "string",
                                        description: "Start time in 24-hour format (HH:MM).",
                                    },
                                    end: {
                                        type: "string",
                                        description: "End time in 24-hour format (HH:MM), or null if not specified.",
                                        nullable: true,
                                    },
                                    isSpecificTime: {
                                        type: "boolean",
                                        description: "Whether this is a specific time point (at X) vs. a range.",
                                    },
                                    isTimeRange: {
                                        type: "boolean",
                                        description: "Whether this is a time range (between X and Y, or from X to Y).",
                                    },
                                    isAllDay: {
                                        type: "boolean",
                                        description: "Whether this is an all-day availability.",
                                    },
                                    sourceTimezone: {
                                        type: "string",
                                        description: "The timezone mentioned in the email, returned strictly in IANA format (e.g., 'America/New_York', 'Europe/Kyiv'). Do not return abbreviations like 'PST' or 'ET'. If an abbreviation is mentioned, convert it to the correct IANA timezone.",
                                        nullable: true,
                                    },
                                },
                                required: [
                                    "start",
                                    "isSpecificTime",
                                    "isTimeRange",
                                    "sourceTimezone",
                                ],
                            },
                        },
                    },
                    required: ["date", "times"],
                },
            },
            event_title: {
                type: "string",
                description: "Suggested title for the event based on the email content.",
            },
            email_reply: {
                type: "string",
                description: "Suggested response including a placeholder for the selected slot.",
            },
            meeting_duration: {
                type: "number",
                description: "The requested meeting duration in minutes extracted from the email content, if specified. Default to null if not mentioned.",
                nullable: true,
            },
        },
        required: ["dates", "event_title", "email_reply"],
    },
};
/**
 * Process extracted dates and times to create suggested slots
 *
 * FIXED:
 * 1. Times with explicit timezones are properly converted to user's timezone
 * 2. Times with null sourceTimezone (indicating local time) are preserved as-is
 * 3. Null values for sourceTimezone are properly maintained throughout the pipeline
 *
 * This fix ensures that when a time is specified in the user's local timezone (indicated by
 * sourceTimezone=null), it is not incorrectly converted as if it were UTC.
 *
 * @param extractedData Data extracted from email content
 * @returns Array of suggested slots with start and end times appropriately converted based on timezone
 */
const processSuggestedSlots = (extractedData, sourceTimezone = null, // The timezone mentioned in the email (sender's timezone)
userTimezone = "UTC" // The user's timezone for conversion
) => {
    let suggestedSlots = [];
    if (extractedData && extractedData.dates && extractedData.dates.length > 0) {
        console.log("Processing extracted dates using local time approach:", extractedData.dates);
        for (const dateInfo of extractedData.dates) {
            try {
                // Parse the date and create time slots
                const date = dateInfo.date;
                // If times array is empty, create an all-day slot
                if (!dateInfo.times || dateInfo.times.length === 0) {
                    console.log(`No times specified for date ${date}, creating an all-day slot`);
                    // Use business hours as the default all-day slot
                    // Keep simple format: YYYY-MM-DD + local time HH:MM:SS
                    const startTime = `${date}T09:00:00`;
                    const endTime = `${date}T18:00:00`;
                    console.log(`Added fallback all-day slot using local time:`, {
                        start: startTime,
                        end: endTime,
                        isTimeRange: true,
                        isAllDay: true,
                    });
                    // Store the all-day slot for processing by calendar functions
                    suggestedSlots.push({
                        start: startTime,
                        end: endTime,
                        // Store original time format exactly as extracted (both null for all-day)
                        originalStart: undefined,
                        originalEnd: undefined,
                        isTimeRange: true,
                        isAllDay: true,
                        // Adding isSpecificTime and fromTimeRange flags for consistency
                        isSpecificTime: false,
                        fromTimeRange: true,
                        // FIXED: Preserve null sourceTimezone value for local time semantics
                        // Using our helper function to satisfy TypeScript's type system
                        sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(sourceTimezone),
                    });
                }
                // Process explicit times from the email
                else {
                    console.log(`Found ${dateInfo.times.length} explicit times for date ${date}`);
                    for (const timeSlot of dateInfo.times) {
                        if (!timeSlot.start)
                            continue;
                        // Using local time concept: all times are treated as simple local times
                        // without timezone conversions
                        // For time range and all-day processing
                        if (timeSlot.isTimeRange || timeSlot.isAllDay) {
                            // Handle time ranges with special cases for null start/end times
                            // CASE 1: Both start and end times are specified
                            if (timeSlot.start && timeSlot.end) {
                                // Format: YYYY-MM-DDThh:mm:ss (local time)
                                const startTime = `${date}T${timeSlot.start}:00`;
                                const endTime = `${date}T${timeSlot.end}:00`;
                                console.log(`Added time range slot with both times specified (local time):`, {
                                    start: startTime,
                                    end: endTime,
                                    isTimeRange: true,
                                    isAllDay: timeSlot.isAllDay || false,
                                });
                                // Determine the timezone to use for this specific slot
                                // Convert any timezone abbreviations (like ET, PST) to IANA timezones (America/New_York, America/Los_Angeles)
                                const rawSlotSourceTimezone = timeSlot.sourceTimezone || sourceTimezone;
                                // Use the proper IANA timezone identifier for reliable conversions
                                const slotSourceTimezone = rawSlotSourceTimezone
                                    ? (0, timezone_utils_1.convertTimezoneAbbreviation)(rawSlotSourceTimezone)
                                    : undefined;
                                console.log(`Using source timezone for conversion: ${rawSlotSourceTimezone} → ${slotSourceTimezone}`);
                                // Check if it's local time using the simplified approach:
                                // If no timezone is specified, it's local time
                                const isLocalTimeFlag = (0, exports.isLocalTimeByTimezone)(timeSlot.sourceTimezone || sourceTimezone);
                                // Convert from source timezone to user timezone if needed
                                let convertedStartTime = startTime;
                                let convertedEndTime = endTime;
                                // Only attempt conversion if:
                                // 1. A source timezone is specified
                                // 2. The time is not marked as local time
                                // 3. User timezone is known and different from source
                                if (slotSourceTimezone &&
                                    !isLocalTimeFlag &&
                                    userTimezone &&
                                    slotSourceTimezone !== userTimezone) {
                                    try {
                                        // STEP 1: Convert from source timezone to user's timezone
                                        const startInSourceTZ = moment_timezone_1.default.tz(`${date}T${timeSlot.start}:00`, slotSourceTimezone);
                                        const endInSourceTZ = moment_timezone_1.default.tz(`${date}T${timeSlot.end}:00`, slotSourceTimezone);
                                        // STEP 2: Get the time in user's timezone
                                        const startInUserTZ = startInSourceTZ
                                            .clone()
                                            .tz(userTimezone);
                                        const endInUserTZ = endInSourceTZ.clone().tz(userTimezone);
                                        // Format for logs and direct display
                                        const userStartFormatted = startInUserTZ.format("YYYY-MM-DDTHH:mm:ss");
                                        const userEndFormatted = endInUserTZ.format("YYYY-MM-DDTHH:mm:ss");
                                        console.log(`FIXED: Converted time range from ${slotSourceTimezone} to ${userTimezone}:`, {
                                            originalStart: `${date}T${timeSlot.start}:00 ${slotSourceTimezone}`,
                                            originalEnd: `${date}T${timeSlot.end}:00 ${slotSourceTimezone}`,
                                            convertedStart: userStartFormatted,
                                            convertedEnd: userEndFormatted,
                                        });
                                        // STEP 3: Generate shorter slots from this time range (e.g., 45-min meetings)
                                        const slotDuration = 45; // minutes
                                        const slotInterval = 60; // minutes (1 hour)
                                        // Generate slots within the time range in user's timezone
                                        let currentSlotStart = startInUserTZ.clone();
                                        let slotsGenerated = 0;
                                        while (currentSlotStart.isBefore(endInUserTZ)) {
                                            const slotEnd = currentSlotStart
                                                .clone()
                                                .add(slotDuration, "minutes");
                                            // Only add if the entire slot fits within the time range
                                            if (slotEnd.isSameOrBefore(endInUserTZ)) {
                                                // Format the local times (for display)
                                                const slotStartLocal = currentSlotStart.format("YYYY-MM-DDTHH:mm:ss");
                                                const slotEndLocal = slotEnd.format("YYYY-MM-DDTHH:mm:ss");
                                                // Convert to UTC for storage
                                                const slotStartUTC = currentSlotStart
                                                    .clone()
                                                    .utc()
                                                    .format();
                                                const slotEndUTC = slotEnd.clone().utc().format();
                                                // Add the slot
                                                suggestedSlots.push({
                                                    // UTC times for storage
                                                    start: slotStartUTC,
                                                    end: slotEndUTC,
                                                    // Don't include originalStart and originalEnd for individual slots
                                                    // This prevents them from being re-grouped in the UI
                                                    // Instead, mark with this special flag for proper handling
                                                    fromTimeRange: true,
                                                    // Store the formatted times for these individual slots
                                                    startSource: currentSlotStart.format("HH:mm"),
                                                    endSource: slotEnd.format("HH:mm"),
                                                    // Additional metadata
                                                    isTimeRange: false,
                                                    isAllDay: false,
                                                    isSpecificTime: true,
                                                    sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(slotSourceTimezone),
                                                });
                                                slotsGenerated++;
                                                console.log(`Generated slot ${slotsGenerated}: ${slotStartUTC} to ${slotEndUTC} (${slotStartLocal} to ${slotEndLocal} ${moment_timezone_1.default
                                                    .tz(userTimezone)
                                                    .zoneAbbr()})`);
                                            }
                                            // Move to next slot
                                            currentSlotStart.add(slotInterval, "minutes");
                                        }
                                        console.log(`Total slots generated from time range: ${slotsGenerated}`);
                                        // Skip adding the original time range since we've broken it into slots
                                        continue;
                                    }
                                    catch (conversionError) {
                                        console.error("Error in improved time range expansion:", conversionError);
                                        // Fall back to original approach - add the whole time range
                                        suggestedSlots.push({
                                            start: startTime,
                                            end: endTime,
                                            // Store original time format exactly as extracted
                                            originalStart: timeSlot.start,
                                            originalEnd: timeSlot.end,
                                            isTimeRange: true,
                                            isAllDay: timeSlot.isAllDay || false,
                                            sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(slotSourceTimezone),
                                        });
                                    }
                                }
                                else {
                                    // For local times without timezone conversion, add the whole time range
                                    suggestedSlots.push({
                                        start: convertedStartTime,
                                        end: convertedEndTime,
                                        // Store original time format exactly as it appeared in the email
                                        originalStart: timeSlot.start,
                                        originalEnd: timeSlot.end,
                                        isTimeRange: true,
                                        isSpecificTime: false,
                                        fromTimeRange: true,
                                        isAllDay: timeSlot.isAllDay || false,
                                        sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(slotSourceTimezone),
                                    });
                                }
                            }
                            // CASE 2: Start time is specified but end time is null (e.g., "after 3pm")
                            else if (timeSlot.start &&
                                (!timeSlot.end || timeSlot.end === null)) {
                                const startTime = `${date}T${timeSlot.start}:00`;
                                // Use empty string instead of null for TypeScript compatibility
                                const placeholderEnd = `${date}T23:59:59`; // Placeholder that will be replaced
                                console.log(`Added time range slot with only start time (local time):`, {
                                    start: startTime,
                                    end: placeholderEnd, // Using placeholder instead of null
                                    isTimeRange: true,
                                    isAllDay: false,
                                    needsEndTimeCalculation: true, // Flag to indicate end time needs replacement
                                });
                                suggestedSlots.push({
                                    start: startTime,
                                    end: placeholderEnd, // Using placeholder instead of null
                                    // Store original time format exactly as extracted
                                    originalStart: timeSlot.start,
                                    originalEnd: undefined, // Value was missing in the original extraction
                                    isTimeRange: true,
                                    isSpecificTime: false,
                                    fromTimeRange: true,
                                    isAllDay: false,
                                    needsEndTimeCalculation: true, // Flag to indicate end time needs replacement
                                    sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(timeSlot.sourceTimezone || sourceTimezone), // Store the specific time's timezone with null preserved
                                });
                            }
                            // CASE 3: End time is specified but start time is null (e.g., "before 5pm")
                            else if ((!timeSlot.start || timeSlot.start === null) &&
                                timeSlot.end) {
                                const endTime = `${date}T${timeSlot.end}:00`;
                                // Use empty string instead of null for TypeScript compatibility
                                const placeholderStart = `${date}T00:00:00`; // Placeholder that will be replaced
                                console.log(`Added time range slot with only end time (local time):`, {
                                    start: placeholderStart, // Using placeholder instead of null
                                    end: endTime,
                                    isTimeRange: true,
                                    isAllDay: false,
                                    needsStartTimeCalculation: true, // Flag to indicate start time needs replacement
                                });
                                suggestedSlots.push({
                                    start: placeholderStart, // Using placeholder instead of null
                                    end: endTime,
                                    // Store original time format exactly as extracted
                                    originalStart: undefined, // Value was missing in the original extraction
                                    originalEnd: timeSlot.end,
                                    isTimeRange: true,
                                    isSpecificTime: false,
                                    fromTimeRange: true,
                                    isAllDay: false,
                                    needsStartTimeCalculation: true, // Flag to indicate start time needs replacement
                                    sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(timeSlot.sourceTimezone || sourceTimezone), // Store the specific time's timezone with null preserved
                                });
                            }
                            // CASE 4: All-day availability (both start and end are null)
                            else if ((!timeSlot.start || timeSlot.start === null) &&
                                (!timeSlot.end || timeSlot.end === null)) {
                                const startTime = `${date}T09:00:00`; // Default all-day start
                                const endTime = `${date}T18:00:00`; // Default all-day end
                                console.log(`Added all-day slot with default business hours:`, {
                                    start: startTime,
                                    end: endTime,
                                    isTimeRange: true,
                                    isAllDay: true,
                                });
                                suggestedSlots.push({
                                    start: startTime,
                                    end: endTime,
                                    // Store original time format exactly as extracted (both null for all-day)
                                    originalStart: undefined,
                                    originalEnd: undefined,
                                    isTimeRange: true,
                                    isSpecificTime: false,
                                    fromTimeRange: true,
                                    isAllDay: true,
                                    sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(timeSlot.sourceTimezone || sourceTimezone), // Store the specific time's timezone with null preserved
                                });
                            }
                        }
                        // For specific times, process them as before
                        else if (timeSlot.isSpecificTime) {
                            // Create a slot for this explicit time
                            const startTime = `${date}T${timeSlot.start}:00`;
                            // Calculate end time - default to +30 min if not specified
                            let endTime;
                            if (timeSlot.end) {
                                endTime = `${date}T${timeSlot.end}:00`;
                            }
                            else {
                                // Default to 30 minutes if not specified
                                const endTimeDate = new Date(startTime);
                                endTimeDate.setMinutes(endTimeDate.getMinutes() + 30);
                                endTime = endTimeDate.toISOString();
                            }
                            console.log("Adding specific time slot:", {
                                start: startTime,
                                end: endTime,
                                isSpecificTime: true,
                            });
                            // Determine the timezone to use for this specific slot
                            // Convert any timezone abbreviations (like ET, PST) to IANA timezones (America/New_York, America/Los_Angeles)
                            const rawSlotSourceTimezone = timeSlot.sourceTimezone || sourceTimezone;
                            // Use the proper IANA timezone identifier for reliable conversions
                            const slotSourceTimezone = rawSlotSourceTimezone
                                ? (0, timezone_utils_1.convertTimezoneAbbreviation)(rawSlotSourceTimezone)
                                : undefined;
                            console.log(`Using source timezone for specific time: ${rawSlotSourceTimezone} → ${slotSourceTimezone}`);
                            // Check if it's local time - simplified approach based on sourceTimezone
                            // If a timezone is specified, it should never be considered local time
                            const isLocalTime = (0, exports.isLocalTimeByTimezone)(timeSlot.sourceTimezone || sourceTimezone);
                            // Convert from source timezone to user timezone if needed
                            let convertedStartTime = startTime;
                            let convertedEndTime = endTime;
                            // Only attempt conversion if:
                            // 1. A source timezone is specified
                            // 2. User timezone is known and different from source
                            // Note: Removed !isLocalTimeFlag check since we're now using effectiveLocalTimeFlag
                            if (slotSourceTimezone &&
                                userTimezone &&
                                slotSourceTimezone !== userTimezone) {
                                try {
                                    // Convert from sender's timezone to user's timezone
                                    const startInSourceTZ = moment_timezone_1.default.tz(`${date}T${timeSlot.start}:00`, slotSourceTimezone);
                                    // Format as ISO strings in user's timezone
                                    convertedStartTime = startInSourceTZ
                                        .tz(userTimezone)
                                        .format("YYYY-MM-DDTHH:mm:ss");
                                    // For end time, check if it's from default calculation or explicitly provided
                                    if (timeSlot.end) {
                                        const endInSourceTZ = moment_timezone_1.default.tz(`${date}T${timeSlot.end}:00`, slotSourceTimezone);
                                        convertedEndTime = endInSourceTZ
                                            .tz(userTimezone)
                                            .format("YYYY-MM-DDTHH:mm:ss");
                                    }
                                    else {
                                        // If end time was calculated (original endTime is in ISO format), recalculate in user's timezone
                                        const startMoment = moment_timezone_1.default.tz(convertedStartTime, userTimezone);
                                        const endMoment = startMoment.clone().add(30, "minutes");
                                        convertedEndTime = endMoment.format("YYYY-MM-DDTHH:mm:ss");
                                    }
                                    console.log(`Converted specific time from ${slotSourceTimezone} to ${userTimezone}:`, {
                                        originalStart: startTime,
                                        originalEnd: endTime,
                                        convertedStart: convertedStartTime,
                                        convertedEnd: convertedEndTime,
                                        isSourceTimezoneUsed: !isLocalTime,
                                    });
                                }
                                catch (conversionError) {
                                    console.error("Error converting timezone for specific time:", conversionError);
                                    // Fall back to original times if conversion fails
                                }
                            }
                            // Add this explicit time to suggested slots
                            // This fix ensures that times with explicit timezones (like 10:00 AM PDT)
                            // are correctly handled for timezone conversion
                            suggestedSlots.push({
                                start: convertedStartTime,
                                end: convertedEndTime,
                                // Store the original time format exactly as extracted
                                originalStart: timeSlot.start,
                                originalEnd: timeSlot.end,
                                isSpecificTime: true,
                                sourceTimezone: (0, timezone_response_fix_1.preserveSourceTimezoneNull)(slotSourceTimezone), // Store the specific time's timezone
                            });
                        }
                    }
                }
            }
            catch (slotError) {
                console.error("Error creating slots for date:", dateInfo, slotError);
            }
        }
    }
    return suggestedSlots;
};
exports.processSuggestedSlots = processSuggestedSlots;
