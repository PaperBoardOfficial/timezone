"use strict";
/**
 * Timezone Conversion Service
 *
 * This module provides centralized functions for handling timezone conversions
 * in Alphie's email analysis and scheduling workflows.
 *
 * Core functionality:
 * 1. Convert extracted times from sourceTimezone to user's local timezone
 * 2. Generate proper meeting slots with comprehensive timezone information
 * 3. Ensure consistent timezone data throughout the application
 * 4. Provide a dedicated server-side endpoint for timezone conversion
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertTimezoneSafe = convertTimezoneSafe;
exports.getTimezoneAbbreviation = getTimezoneAbbreviation;
exports.convertExtractedTimesToUserTimezone = convertExtractedTimesToUserTimezone;
exports.generateSlots = generateSlots;
exports.processEmailAnalysisWithTimezones = processEmailAnalysisWithTimezones;
exports.generateShorterSlotsFromRange = generateShorterSlotsFromRange;
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const timezone_utils_1 = require("./timezone-utils");
/**
 * Safely convert time from one timezone to another
 * This function implements the correct 3-step approach:
 * 1. Parse the time with source timezone
 * 2. Convert to UTC (critical intermediary step)
 * 3. Convert from UTC to target timezone
 *
 * @param date Date string (YYYY-MM-DD)
 * @param time Time string (HH:mm)
 * @param sourceTimezone Source timezone (IANA format or abbreviation)
 * @param targetTimezone Target timezone (IANA format or abbreviation)
 * @returns Object with formatted time in target timezone and additional information
 */
function convertTimezoneSafe(date, time, sourceTimezone, targetTimezone) {
    try {
        // Convert timezone abbreviations to IANA identifiers
        const sourceIANA = (0, timezone_utils_1.convertTimezoneAbbreviation)(sourceTimezone) || "UTC";
        const targetIANA = (0, timezone_utils_1.convertTimezoneAbbreviation)(targetTimezone) || "UTC";
        // Step 1: Parse with source timezone
        const dateTimeStr = `${date}T${time}:00`;
        const timeInSourceTz = moment_timezone_1.default.tz(dateTimeStr, sourceIANA);
        // Step 2: Convert to UTC first (critical step for correct conversion)
        const timeInUTC = timeInSourceTz.clone().utc();
        // Step 3: Convert from UTC to target timezone
        const timeInTargetTz = timeInUTC.clone().tz(targetIANA);
        // Get timezone offsets (in minutes)
        const sourceOffset = timeInSourceTz.utcOffset();
        const targetOffset = timeInTargetTz.utcOffset();
        // Calculate hour difference
        const hourDifference = (targetOffset - sourceOffset) / 60;
        return {
            convertedTime: timeInTargetTz.format("HH:mm"),
            sourceTimezone: sourceIANA,
            targetTimezone: targetIANA,
            sourceOffset: sourceOffset / 60, // convert to hours
            targetOffset: targetOffset / 60, // convert to hours
            hourDifference,
            sourceFormatted: timeInSourceTz.format("h:mm A"),
            targetFormatted: timeInTargetTz.format("h:mm A"),
            utcTime: timeInUTC.format("HH:mm"),
        };
    }
    catch (error) {
        console.error("Error converting timezone:", error);
        // Return fallback result
        return {
            convertedTime: time,
            sourceTimezone: sourceTimezone,
            targetTimezone: targetTimezone,
            sourceOffset: 0,
            targetOffset: 0,
            hourDifference: 0,
            sourceFormatted: time,
            targetFormatted: time,
            utcTime: time,
        };
    }
}
/**
 * Gets the abbreviation for a timezone (e.g., "EST", "PDT", "EEST")
 *
 * @param timezone IANA timezone identifier (e.g., "America/New_York")
 * @param date Optional date to get the abbreviation for (defaults to current date)
 * @returns Timezone abbreviation (e.g., "ET", "PT")
 */
function getTimezoneAbbreviation(timezone, date) {
    if (!timezone)
        return "UTC";
    try {
        // Create a moment object with either the provided date or current date
        const momentObj = date ? moment_timezone_1.default.tz(date, timezone) : moment_timezone_1.default.tz(timezone);
        // Get abbreviation based on the date (handles DST correctly)
        const abbr = momentObj.format("z");
        return abbr;
    }
    catch (error) {
        console.error(`Error getting timezone abbreviation for ${timezone}:`, error);
        return "UTC";
    }
}
/**
 * Creates a separate converted data structure from the raw extracted email data
 * Keeps the original extracted data pure without conversion modifications
 *
 * @param extractedData - The data extracted from the email by AI analysis
 * @param userTimezone - The user's local timezone (e.g., "Europe/Kyiv")
 * @returns The converted data structure with times in user's timezone
 */
function convertExtractedTimesToUserTimezone(extractedData, userTimezone) {
    if (!extractedData || !extractedData.dates || !extractedData.dates.length) {
        return extractedData;
    }
    // Create a deep copy to avoid modifying the original
    const result = JSON.parse(JSON.stringify(extractedData));
    // Get user timezone abbreviation for UI display
    const localTimeAbbreviation = getTimezoneAbbreviation(userTimezone);
    // Process all dates and times to create converted structure
    result.dates = result.dates.map((dateInfo) => {
        const processedDateInfo = { ...dateInfo, times: [] };
        const currentDate = dateInfo.date;
        if (dateInfo.times && dateInfo.times.length > 0) {
            processedDateInfo.times = dateInfo.times.map((timeSlot) => {
                // Create a new time slot object with clean structure - IMPORTANT: Do NOT include start/end
                const convertedTimeSlot = {
                    // Preserve metadata
                    isSpecificTime: timeSlot.isSpecificTime,
                    isTimeRange: timeSlot.isTimeRange,
                    isAllDay: timeSlot.isAllDay,
                    // Keep track of source timezone
                    sourceTimezone: timeSlot.sourceTimezone,
                    // Store original values
                    originalStart: timeSlot.start || timeSlot.originalStart,
                    originalEnd: timeSlot.end || timeSlot.originalEnd,
                };
                // Get the IANA timezone if sourceTimezone is available
                const sourceIANA = timeSlot.sourceTimezone
                    ? (0, timezone_utils_1.convertTimezoneAbbreviation)(timeSlot.sourceTimezone)
                    : null;
                // Get source timezone abbreviation using the specific date
                const sourceTimeAbbreviation = sourceIANA
                    ? getTimezoneAbbreviation(sourceIANA, currentDate)
                    : null;
                // Add source timezone abbreviation
                convertedTimeSlot.sourceTime = sourceTimeAbbreviation;
                const date = dateInfo.date;
                let convertedDate = date;
                // Only do conversion if sourceTimezone exists and is different from user timezone
                if (sourceIANA && sourceIANA !== userTimezone) {
                    try {
                        // Get the time values to convert, ensure we have values to work with
                        const startTimeValue = timeSlot.start || timeSlot.originalStart;
                        const endTimeValue = timeSlot.end || timeSlot.originalEnd;
                        // Convert start time from source timezone to user timezone
                        if (startTimeValue) {
                            // Ensure we're using the IANA timezone identifier, not the abbreviation
                            console.log(`Converting start time from ${sourceIANA} to ${userTimezone}`);
                            // Step 1: Parse with source timezone
                            const startInSourceTz = moment_timezone_1.default.tz(`${date}T${startTimeValue}:00`, sourceIANA);
                            // Step 2: Convert to UTC first (critical step for correct conversion)
                            const startInUTC = startInSourceTz.clone().utc();
                            // Step 3: Convert from UTC to user timezone
                            const startInUserTz = startInUTC.clone().tz(userTimezone);
                            // Set the converted start time - store as convertedStart instead of start
                            convertedTimeSlot.convertedStart = startInUserTz.format("HH:mm");
                            // If day changed during conversion, update the date
                            if (startInUserTz.format("YYYY-MM-DD") !== date) {
                                convertedTimeSlot.dayChanged = true;
                                convertedDate = startInUserTz.format("YYYY-MM-DD");
                                convertedTimeSlot.convertedDate = convertedDate;
                            }
                        }
                        // Convert end time from source timezone to user timezone
                        if (endTimeValue) {
                            // Ensure we're using the IANA timezone identifier, not the abbreviation
                            console.log(`Converting end time from ${sourceIANA} to ${userTimezone}`);
                            // Step 1: Parse with source timezone
                            const endInSourceTz = moment_timezone_1.default.tz(`${date}T${endTimeValue}:00`, sourceIANA);
                            // Step 2: Convert to UTC first (critical step for correct conversion)
                            const endInUTC = endInSourceTz.clone().utc();
                            // Step 3: Convert from UTC to user timezone
                            const endInUserTz = endInUTC.clone().tz(userTimezone);
                            // Set the converted end time - store as convertedEnd instead of end
                            convertedTimeSlot.convertedEnd = endInUserTz.format("HH:mm");
                        }
                        console.log(`Converted time from ${sourceIANA} to ${userTimezone}:`, {
                            original: {
                                start: convertedTimeSlot.originalStart,
                                end: convertedTimeSlot.originalEnd,
                            },
                            converted: {
                                start: convertedTimeSlot.convertedStart,
                                end: convertedTimeSlot.convertedEnd,
                            },
                        });
                    }
                    catch (error) {
                        console.error(`Error converting time from ${sourceIANA} to ${userTimezone}:`, error);
                        // Do not add start/end to the extracted data, as it should remain pure
                        // We'll store these as convertedStart/convertedEnd instead
                        convertedTimeSlot.convertedStart =
                            timeSlot.start || timeSlot.originalStart;
                        convertedTimeSlot.convertedEnd =
                            timeSlot.end || timeSlot.originalEnd;
                    }
                }
                else {
                    // No conversion needed, just copy the times
                    convertedTimeSlot.convertedStart =
                        timeSlot.start || timeSlot.originalStart;
                    convertedTimeSlot.convertedEnd = timeSlot.end || timeSlot.originalEnd;
                }
                return convertedTimeSlot;
            });
        }
        return processedDateInfo;
    });
    return result;
}
/**
 * Generate meeting slots from the extracted dates and times
 *
 * @param extractedData - The data extracted from email with times in user's timezone
 * @param userTimezone - The user's local timezone (e.g., "Europe/Kyiv")
 * @param meetingDuration - Duration of the meeting in minutes (default: 45)
 * @param slotInterval - Interval between slot starts in minutes (default: 60)
 * @returns Array of suggested slots with comprehensive timezone information
 */
function generateSlots(extractedData, userTimezone, meetingDuration = 45, slotInterval = 60) {
    // Ensure we have a valid meeting duration
    const duration = meetingDuration || 45;
    // moment-timezone is already imported at the top of the file
    const suggestedSlots = [];
    if (!extractedData || !extractedData.dates || !extractedData.dates.length) {
        return suggestedSlots;
    }
    for (const dateInfo of extractedData.dates) {
        const date = dateInfo.date;
        if (!dateInfo.times || dateInfo.times.length === 0) {
            // Handle all-day availability (no times specified)
            const startTime = `${date}T09:00:00`;
            const endTime = `${date}T18:00:00`;
            // Get the local timezone abbreviation
            const localTimeAbbr = getTimezoneAbbreviation(userTimezone);
            suggestedSlots.push({
                // Basic slot information
                start: startTime,
                end: endTime,
                // Time format variations
                startLocal: startTime,
                endLocal: endTime,
                startUTC: moment_timezone_1.default
                    .tz(startTime, userTimezone)
                    .utc()
                    .format("YYYY-MM-DDTHH:mm:ss") + "Z",
                endUTC: moment_timezone_1.default.tz(endTime, userTimezone).utc().format("YYYY-MM-DDTHH:mm:ss") +
                    "Z",
                // Source information
                fromTimeRange: true,
                sourceTimezone: userTimezone, // Use user timezone if none provided
                sourceTime: localTimeAbbr, // Use local timezone abbreviation
                // Original values
                originalStart: "09:00",
                originalEnd: "18:00",
                // Metadata
                isTimeRange: true,
                isAllDay: true,
                isSpecificTime: true, // Set to true for all slots
                localTimezone: userTimezone,
                localTime: localTimeAbbr,
            });
        }
        else {
            // Process explicit times from the email
            for (const timeSlot of dateInfo.times) {
                // Check for convertedStart or originalStart since we've removed direct start/end
                if (!timeSlot.convertedStart && !timeSlot.originalStart)
                    continue;
                // Handle time range slots
                if (timeSlot.isTimeRange || timeSlot.isAllDay) {
                    // Get the start/end times from convertedStart/End (new fields) or fall back to originalStart/End
                    const startTimeValue = timeSlot.convertedStart || timeSlot.originalStart;
                    const endTimeValue = timeSlot.convertedEnd || timeSlot.originalEnd;
                    if (startTimeValue && endTimeValue) {
                        // Use the date from the converted date if day changed during conversion
                        const slotDate = timeSlot.dayChanged
                            ? timeSlot.convertedDate
                            : date;
                        const startTime = `${slotDate}T${startTimeValue}:00`;
                        const endTime = `${slotDate}T${endTimeValue}:00`;
                        // Get moment objects in user timezone for easier manipulation
                        const startMoment = moment_timezone_1.default.tz(startTime, userTimezone);
                        const endMoment = moment_timezone_1.default.tz(endTime, userTimezone);
                        // Generate shorter slots from this time range
                        let currentSlotStart = startMoment.clone();
                        while (currentSlotStart.isBefore(endMoment)) {
                            const slotEnd = currentSlotStart.clone().add(duration, "minutes");
                            // Only add if the entire slot fits within the time range
                            if (slotEnd.isSameOrBefore(endMoment)) {
                                // Format times in different formats for all needs
                                // For local time, use the user's timezone format without Z suffix
                                const slotStartLocal = currentSlotStart.format("YYYY-MM-DDTHH:mm:ss");
                                const slotEndLocal = slotEnd.format("YYYY-MM-DDTHH:mm:ss");
                                // For UTC format, explicitly convert to UTC and include Z suffix
                                const slotStartUTC = currentSlotStart.clone().utc().format("YYYY-MM-DDTHH:mm:ss") +
                                    "Z";
                                const slotEndUTC = slotEnd.clone().utc().format("YYYY-MM-DDTHH:mm:ss") + "Z";
                                // Get local and source timezone abbreviations
                                const localTimeAbbr = getTimezoneAbbreviation(userTimezone);
                                const sourceTimeAbbr = timeSlot.sourceTimezone
                                    ? getTimezoneAbbreviation(timeSlot.sourceTimezone)
                                    : null;
                                // Add the candidate slot with comprehensive timezone information
                                // Calculate source timezone and original times
                                const actualSourceTimezone = timeSlot.sourceTimezone || userTimezone;
                                // Calculate original times by converting from local timezone to source timezone
                                let originalStart, originalEnd;
                                // Only convert if source timezone is different from local
                                if (actualSourceTimezone !== userTimezone) {
                                    try {
                                        // Convert current slot time from local to source timezone
                                        const localStartMoment = moment_timezone_1.default.tz(slotStartLocal, userTimezone);
                                        const sourceStartMoment = localStartMoment
                                            .clone()
                                            .tz(actualSourceTimezone);
                                        originalStart = sourceStartMoment.format("HH:mm");
                                        const localEndMoment = moment_timezone_1.default.tz(slotEndLocal, userTimezone);
                                        const sourceEndMoment = localEndMoment
                                            .clone()
                                            .tz(actualSourceTimezone);
                                        originalEnd = sourceEndMoment.format("HH:mm");
                                    }
                                    catch (error) {
                                        console.error("Error converting time back to source timezone:", error);
                                        originalStart =
                                            timeSlot.originalStart ||
                                                currentSlotStart.format("HH:mm");
                                        originalEnd =
                                            timeSlot.originalEnd || slotEnd.format("HH:mm");
                                    }
                                }
                                else {
                                    // If timezones are the same, use time value directly
                                    originalStart = currentSlotStart.format("HH:mm");
                                    originalEnd = slotEnd.format("HH:mm");
                                }
                                suggestedSlots.push({
                                    // Basic slot information (using local timezone for display)
                                    start: slotStartLocal,
                                    end: slotEndLocal,
                                    // Time format variations
                                    startLocal: slotStartLocal,
                                    endLocal: slotEndLocal,
                                    startUTC: slotStartUTC,
                                    endUTC: slotEndUTC,
                                    // Source information (original time from the email)
                                    fromTimeRange: true,
                                    sourceTimezone: actualSourceTimezone,
                                    sourceTime: sourceTimeAbbr,
                                    // Original values with properly calculated times
                                    originalStart: originalStart,
                                    originalEnd: originalEnd,
                                    // Metadata
                                    isTimeRange: false,
                                    isAllDay: false,
                                    isSpecificTime: true,
                                    localTimezone: userTimezone,
                                    localTime: localTimeAbbr,
                                });
                            }
                            // Move to next slot based on interval
                            currentSlotStart.add(slotInterval, "minutes");
                        }
                    }
                    else if ((timeSlot.convertedStart || timeSlot.originalStart) &&
                        !(timeSlot.convertedEnd || timeSlot.originalEnd)) {
                        // Handle "after X" scenarios (start time but no end time)
                        // Get the start time from convertedStart or fall back to originalStart
                        const startTimeValue = timeSlot.convertedStart || timeSlot.originalStart;
                        // Use the date from the converted date if day changed during conversion
                        const slotDate = timeSlot.dayChanged
                            ? timeSlot.convertedDate
                            : date;
                        const startTime = `${slotDate}T${startTimeValue}:00`;
                        // Default to end of workday (6 PM)
                        const endTime = `${slotDate}T18:00:00`;
                        // Get local and source timezone abbreviations
                        const localTimeAbbr = getTimezoneAbbreviation(userTimezone);
                        const sourceTimeAbbr = timeSlot.sourceTimezone
                            ? getTimezoneAbbreviation(timeSlot.sourceTimezone)
                            : null;
                        // Get source timezone or fall back to user timezone
                        const actualSourceTimezone = timeSlot.sourceTimezone || userTimezone;
                        // Calculate original times by converting from local timezone to source timezone
                        let originalStart;
                        let originalEnd = "18:00"; // Default end time
                        // Only convert if source timezone is different from local
                        if (actualSourceTimezone !== userTimezone) {
                            try {
                                // Convert current slot time from local to source timezone
                                const localStartMoment = moment_timezone_1.default.tz(startTime, userTimezone);
                                const sourceStartMoment = localStartMoment
                                    .clone()
                                    .tz(actualSourceTimezone);
                                originalStart = sourceStartMoment.format("HH:mm");
                                const localEndMoment = moment_timezone_1.default.tz(endTime, userTimezone);
                                const sourceEndMoment = localEndMoment
                                    .clone()
                                    .tz(actualSourceTimezone);
                                originalEnd = sourceEndMoment.format("HH:mm");
                            }
                            catch (error) {
                                console.error("Error converting time back to source timezone:", error);
                                originalStart = timeSlot.originalStart || startTimeValue;
                            }
                        }
                        else {
                            // If timezones are the same, use time value directly
                            originalStart = startTimeValue;
                        }
                        // Add a single slot for the "after X" scenario
                        suggestedSlots.push({
                            // Basic slot information
                            start: startTime,
                            end: endTime,
                            // Time format variations
                            startLocal: startTime,
                            endLocal: endTime,
                            startUTC: moment_timezone_1.default
                                .tz(startTime, userTimezone)
                                .utc()
                                .format("YYYY-MM-DDTHH:mm:ss") + "Z",
                            endUTC: moment_timezone_1.default
                                .tz(endTime, userTimezone)
                                .utc()
                                .format("YYYY-MM-DDTHH:mm:ss") + "Z",
                            // Source information
                            fromTimeRange: true,
                            sourceTimezone: actualSourceTimezone,
                            sourceTime: sourceTimeAbbr,
                            // Original values with properly calculated times
                            originalStart: originalStart,
                            originalEnd: originalEnd,
                            // Metadata
                            isTimeRange: true,
                            isAllDay: false,
                            isSpecificTime: true, // Set to true for all slots
                            localTimezone: userTimezone,
                            localTime: localTimeAbbr,
                        });
                    }
                }
                else if (timeSlot.isSpecificTime) {
                    // Handle specific time slots (not ranges)
                    // Get the start time from convertedStart or fall back to originalStart
                    const startTimeValue = timeSlot.convertedStart || timeSlot.originalStart;
                    if (!startTimeValue)
                        continue;
                    // Use the date from the converted date if day changed during conversion
                    const slotDate = timeSlot.dayChanged ? timeSlot.convertedDate : date;
                    const startTime = `${slotDate}T${startTimeValue}:00`;
                    // For specific times, default duration is meeting duration
                    const endTimeMoment = moment_timezone_1.default
                        .tz(startTime, userTimezone)
                        .add(duration, "minutes");
                    const endTime = endTimeMoment.format("YYYY-MM-DDTHH:mm:ss");
                    // Get local and source timezone abbreviations
                    const localTimeAbbr = getTimezoneAbbreviation(userTimezone);
                    const sourceTimeAbbr = timeSlot.sourceTimezone
                        ? getTimezoneAbbreviation(timeSlot.sourceTimezone)
                        : null;
                    // Get source timezone or fall back to user timezone
                    const actualSourceTimezone = timeSlot.sourceTimezone || userTimezone;
                    // Calculate original times by converting from local timezone to source timezone
                    let originalStart, originalEnd;
                    // Only convert if source timezone is different from local
                    if (actualSourceTimezone !== userTimezone) {
                        try {
                            // Convert local time back to source timezone for originalStart
                            const localStartMoment = moment_timezone_1.default.tz(startTime, userTimezone);
                            const sourceStartMoment = localStartMoment
                                .clone()
                                .tz(actualSourceTimezone);
                            originalStart = sourceStartMoment.format("HH:mm");
                            // Convert local time back to source timezone for originalEnd
                            const localEndMoment = moment_timezone_1.default.tz(endTime, userTimezone);
                            const sourceEndMoment = localEndMoment
                                .clone()
                                .tz(actualSourceTimezone);
                            originalEnd = sourceEndMoment.format("HH:mm");
                        }
                        catch (error) {
                            console.error("Error converting time back to source timezone:", error);
                            originalStart = timeSlot.originalStart || startTimeValue;
                            originalEnd = moment_timezone_1.default
                                .tz(startTime, userTimezone)
                                .add(duration, "minutes")
                                .format("HH:mm");
                        }
                    }
                    else {
                        // If timezones are the same, use time value directly
                        originalStart = startTimeValue;
                        originalEnd = moment_timezone_1.default
                            .tz(startTime, userTimezone)
                            .add(duration, "minutes")
                            .format("HH:mm");
                    }
                    suggestedSlots.push({
                        // Basic slot information
                        start: startTime,
                        end: endTime,
                        // Time format variations
                        startLocal: startTime,
                        endLocal: endTime,
                        startUTC: moment_timezone_1.default
                            .tz(startTime, userTimezone)
                            .utc()
                            .format("YYYY-MM-DDTHH:mm:ss") + "Z",
                        endUTC: endTimeMoment.clone().utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
                        // Source information
                        fromTimeRange: false,
                        sourceTimezone: actualSourceTimezone,
                        sourceTime: sourceTimeAbbr,
                        // Original values with properly calculated times
                        originalStart: originalStart,
                        originalEnd: originalEnd,
                        // Metadata
                        isTimeRange: false,
                        isAllDay: false,
                        isSpecificTime: true,
                        localTimezone: userTimezone,
                        localTime: localTimeAbbr,
                    });
                }
            }
        }
    }
    return suggestedSlots;
}
/**
 * Complete timezone conversion process for email analysis results
 *
 * This function performs the entire conversion pipeline:
 * 1. Convert extracted times from source timezone to user timezone
 * 2. Generate candidate meeting slots with comprehensive timezone info
 * 3. Add human-readable timezone information for UI display
 *
 * @param extractedData - The data extracted from email analysis
 * @param userTimezone - The user's local timezone
 * @param meetingDuration - Duration for meeting slots in minutes
 * @param slotInterval - Interval between slot starts in minutes
 * @returns The processed data including converted times and candidate slots
 */
function processEmailAnalysisWithTimezones(extractedData, userTimezone, meetingDuration, slotInterval) {
    // 1. Create a deep copy of the original extractedData to avoid modifying it
    const purifiedExtractedData = JSON.parse(JSON.stringify(extractedData));
    // Remove start and end fields from the extracted data to keep it pure
    if (purifiedExtractedData &&
        purifiedExtractedData.dates &&
        purifiedExtractedData.dates.length > 0) {
        purifiedExtractedData.dates.forEach((date) => {
            if (date.times && date.times.length > 0) {
                date.times.forEach((timeSlot) => {
                    // The extracted data should only contain originalStart and originalEnd
                    // Store original values before removing start/end
                    if (!timeSlot.originalStart && timeSlot.start) {
                        timeSlot.originalStart = timeSlot.start;
                    }
                    if (!timeSlot.originalEnd && timeSlot.end) {
                        timeSlot.originalEnd = timeSlot.end;
                    }
                    // Remove start and end from the original extracted data
                    delete timeSlot.start;
                    delete timeSlot.end;
                });
            }
        });
    }
    // 2. Convert all extracted times to user's timezone
    const convertedData = convertExtractedTimesToUserTimezone(purifiedExtractedData, userTimezone);
    // 3. Generate meeting slots with comprehensive timezone info
    const duration = meetingDuration || extractedData.meeting_duration || 45;
    const interval = slotInterval || 60;
    const candidateSlots = generateSlots(convertedData, userTimezone, duration, interval);
    // 4. Add human-readable timezone abbreviation for UI display
    const localTimeAbbreviation = getTimezoneAbbreviation(userTimezone);
    // Enhance and clean all slots
    candidateSlots.forEach((slot) => {
        // Extract the date from the slot for timezone-specific abbreviations
        const slotDate = slot.start
            ? slot.start.split("T")[0]
            : new Date().toISOString().split("T")[0];
        // Add the local timezone abbreviation for UI display with the specific date
        slot.localTime = getTimezoneAbbreviation(userTimezone, slotDate);
        // Get the source IANA timezone if available
        let sourceIANA = null;
        if (slot.sourceTimezone) {
            // When getting IANA timezone, always use the conversion function first
            sourceIANA = (0, timezone_utils_1.convertTimezoneAbbreviation)(slot.sourceTimezone);
            console.log(`Source timezone ${slot.sourceTimezone} mapped to IANA: ${sourceIANA}`);
            // Correct the sourceTime field based on the date in the slot
            if (sourceIANA) {
                try {
                    // Extract the date from the slot start time
                    const dateTimeForDst = `${slotDate}T12:00:00`;
                    // Use the mapped IANA timezone, not the original abbreviation
                    const sourceTzMoment = moment_timezone_1.default.tz(dateTimeForDst, sourceIANA);
                    // Get the abbreviation based on the specific date (handles DST correctly)
                    slot.sourceTime = getTimezoneAbbreviation(sourceIANA, dateTimeForDst);
                    console.log(`Set sourceTime to ${slot.sourceTime} based on date ${slotDate}`);
                }
                catch (error) {
                    console.error(`Error getting timezone abbreviation for ${sourceIANA}:`, error);
                    // Fallback: Use generic abbreviation for display
                    slot.sourceTime = slot.sourceTimezone;
                }
            }
            else {
                // If mapping failed, just use the original timezone abbreviation
                slot.sourceTime = slot.sourceTimezone;
            }
        }
        // Calculate startSource/endSource if we have a source timezone
        if (sourceIANA && slot.startLocal) {
            try {
                // Extract date and time parts from startLocal
                const dateStr = slot.startLocal.split("T")[0];
                const timeStr = slot.startLocal.split("T")[1].substring(0, 5); // HH:mm
                // Use convertTimezoneSafe to convert from user timezone to source timezone
                const startConversion = convertTimezoneSafe(dateStr, timeStr, userTimezone, sourceIANA);
                // Format the startSource value
                slot.startSource = `${dateStr}T${startConversion.convertedTime}:00`;
                console.log(`Calculated startSource: ${slot.startSource}`);
                // Always set originalStart to the source timezone time, not the local time
                slot.originalStart = startConversion.convertedTime;
                console.log(`Set originalStart: ${slot.originalStart}`);
            }
            catch (error) {
                console.error("Error calculating startSource:", error);
            }
            // Similar processing for endSource
            if (slot.endLocal) {
                try {
                    // Extract date and time parts from endLocal
                    const dateStr = slot.endLocal.split("T")[0];
                    const timeStr = slot.endLocal.split("T")[1].substring(0, 5); // HH:mm
                    // Use convertTimezoneSafe to convert from user timezone to source timezone
                    const endConversion = convertTimezoneSafe(dateStr, timeStr, userTimezone, sourceIANA);
                    // Format the endSource value
                    slot.endSource = `${dateStr}T${endConversion.convertedTime}:00`;
                    console.log(`Calculated endSource: ${slot.endSource}`);
                    // Always set originalEnd to the source timezone time, not the local time
                    slot.originalEnd = endConversion.convertedTime;
                    console.log(`Set originalEnd: ${slot.originalEnd}`);
                }
                catch (error) {
                    console.error("Error calculating endSource:", error);
                }
            }
        }
        // Fix capitalization issue
        if ("LocalTime" in slot) {
            const slotWithLocalTime = slot;
            slotWithLocalTime.LocalTime = localTimeAbbreviation;
        }
        // Ensure isSpecificTime is set to true for all slots
        slot.isSpecificTime = true;
    });
    // 5. Return both the converted data and the candidate slots
    return {
        extractedData: purifiedExtractedData, // Return the purified data without start/end
        candidateSlots: candidateSlots,
    };
}
/**
 * Generate shorter slots from a time range
 * This breaks a longer time range into shorter meeting slots
 *
 * @param slot Slot object with start and end times
 * @param meetingDuration Duration of each meeting in minutes
 * @param slotInterval Interval between slot starts in minutes
 * @param userTimezone User's timezone (optional)
 * @returns Array of generated slots
 */
function generateShorterSlotsFromRange(slot, meetingDuration, slotInterval, userTimezone, localTimezone) {
    console.log("[SLOT_GENERATION:DETAIL] Starting slot generation with parameters:");
    console.log(`[SLOT_GENERATION:DETAIL] Meeting duration: ${meetingDuration} minutes`);
    console.log(`[SLOT_GENERATION:DETAIL] Slot interval: ${slotInterval} minutes`);
    console.log(`[SLOT_GENERATION:DETAIL] User timezone: ${userTimezone || "Not provided"}`);
    console.log(`[SLOT_GENERATION:DETAIL] Input slot: ${JSON.stringify(slot)}`);
    // Log input slot flags for debugging
    console.log(`[SLOT_GENERATION:DETAIL] Input slot flags: isTimeRange=${slot.isTimeRange}, isSpecificTime=${slot.isSpecificTime}, fromTimeRange=${slot.fromTimeRange}, sourceTimezone=${slot.sourceTimezone || "null"}`);
    if (!slot.start || !slot.end) {
        console.log("[SLOT_GENERATION:ERROR] Cannot generate slots from incomplete time range");
        return [slot]; // Return original if missing start or end
    }
    const generatedSlots = [];
    try {
        // FIXED: Check if this is local time (sourceTimezone is null/undefined means it's local time)
        // This is the critical fix - properly identify when a time is meant to be local
        const isLocalTime = slot.sourceTimezone === null || slot.sourceTimezone === undefined;
        console.log(`[SLOT_GENERATION:DETAIL] Is local time: ${isLocalTime}`);
        // Handle local time conversion if needed
        let rangeStart, rangeEnd;
        if (isLocalTime && userTimezone) {
            // For local time slots, we need to keep working in the user's timezone
            console.log(`[SLOT_GENERATION:DETAIL] Processing local time slot in timezone ${userTimezone}`);
            // Parse date and time parts
            const startDate = slot.start.split("T")[0];
            const startTime = slot.start.split("T")[1] || "00:00:00";
            const endDate = slot.end.split("T")[0];
            const endTime = slot.end.split("T")[1] || "23:59:59";
            console.log(`[SLOT_GENERATION:DETAIL] Parsed date/time parts:
        Start date: ${startDate}, Start time: ${startTime}
        End date: ${endDate}, End time: ${endTime}`);
            // Create moment objects in user's timezone but DON'T convert to UTC yet
            rangeStart = moment_timezone_1.default.tz(`${startDate}T${startTime}`, userTimezone);
            rangeEnd = moment_timezone_1.default.tz(`${endDate}T${endTime}`, userTimezone);
            console.log(`[SLOT_GENERATION:DETAIL] Using local times: 
        Local start: ${rangeStart.format("YYYY-MM-DD HH:mm")}
        Local end: ${rangeEnd.format("YYYY-MM-DD HH:mm")} in ${userTimezone}`);
        }
        else if (slot.sourceTimezone && userTimezone) {
            // For slots with a specified source timezone, convert from source to user timezone
            console.log(`[SLOT_GENERATION:DETAIL] Converting from ${slot.sourceTimezone} to ${userTimezone}`);
            // Create moments in the source timezone
            rangeStart = moment_timezone_1.default.tz(slot.start, slot.sourceTimezone);
            rangeEnd = moment_timezone_1.default.tz(slot.end, slot.sourceTimezone);
            // Convert to user's timezone
            rangeStart = rangeStart.tz(userTimezone);
            rangeEnd = rangeEnd.tz(userTimezone);
            console.log(`[SLOT_GENERATION:DETAIL] Converted times: 
        Start in user timezone: ${rangeStart.format("YYYY-MM-DD HH:mm")} ${userTimezone}
        End in user timezone: ${rangeEnd.format("YYYY-MM-DD HH:mm")} ${userTimezone}`);
        }
        else {
            // For UTC time slots with no timezone info, just parse them normally
            rangeStart = (0, moment_timezone_1.default)(slot.start);
            rangeEnd = (0, moment_timezone_1.default)(slot.end);
            console.log(`[SLOT_GENERATION:DETAIL] Using original UTC times: 
        Start: ${rangeStart.toISOString()}
        End: ${rangeEnd.toISOString()}`);
        }
        // Validate range times
        console.log(`[SLOT_GENERATION:DETAIL] Validating range:
      Start valid: ${rangeStart.isValid()}
      End valid: ${rangeEnd.isValid()}
      Start before end: ${rangeStart.isBefore(rangeEnd)}
      Duration (minutes): ${rangeEnd.diff(rangeStart, "minutes")}`);
        // Skip invalid ranges
        if (!rangeStart.isValid() ||
            !rangeEnd.isValid() ||
            rangeStart.isSameOrAfter(rangeEnd)) {
            console.log("[SLOT_GENERATION:ERROR] Invalid time range - start is same or after end time");
            return [slot];
        }
        // Calculate duration in minutes for logging
        const durationMinutes = rangeEnd.diff(rangeStart, "minutes");
        console.log(`[SLOT_GENERATION:DETAIL] Processing slot with duration ${durationMinutes} minutes, ` +
            `creating ${meetingDuration}-minute slots with ${slotInterval}-minute intervals`);
        // IMPROVED: More flexible duration handling for time ranges from emails
        // Always respect the exact time range specified in an email, even if it's shorter
        // than the user's preferred meeting duration
        let adaptedMeetingDuration = meetingDuration;
        let isAdaptedDuration = false;
        // Determine if this is from a time range specified in an email
        // FIX: Check both isTimeRange=true and fromTimeRange=true to handle all cases
        const isEmailTimeRange = slot.isTimeRange === true || slot.fromTimeRange === true;
        if (durationMinutes < meetingDuration) {
            // When the slot comes directly from an email time range, always respect the exact duration
            // regardless of how short it is (as this was the duration explicitly mentioned in the email)
            if (isEmailTimeRange) {
                console.log(`[SLOT_GENERATION:ADAPT] Respecting email-specified time range (${durationMinutes} min) even though shorter than preferred duration (${meetingDuration} min)`);
                adaptedMeetingDuration = durationMinutes;
                isAdaptedDuration = true;
            }
            // Otherwise, only adapt if the duration is at least 25 minutes
            else if (durationMinutes >= 25) {
                console.log(`[SLOT_GENERATION:ADAPT] Adapting meeting duration from ${meetingDuration} to ${durationMinutes} minutes to fit the shorter time range`);
                adaptedMeetingDuration = durationMinutes;
                isAdaptedDuration = true;
            }
            else {
                // If not from email and less than 25 minutes, probably too short for any meaningful meeting
                console.log(`[SLOT_GENERATION:ERROR] Time range (${durationMinutes} min) is too short (< 25 min) for a meeting`);
                // If it's a very short original time range from an email, we should still return it
                // This handles edge cases where the email explicitly mentions a very brief check-in
                // FIX: More lenient check to catch all email-originated time ranges
                if (isEmailTimeRange && durationMinutes >= 10) {
                    console.log(`[SLOT_GENERATION:RECOVER] Even though very short, keeping original email time range as a single slot`);
                    // Update the slot to not be a time range anymore, but preserve that it came from one
                    return [
                        {
                            ...slot,
                            isTimeRange: false, // FIX: This should be false for specific times
                            isSpecificTime: true, // FIX: This should be true for specific times
                            fromTimeRange: true, // FIX: This indicates it was originally a time range
                            adaptedDuration: durationMinutes,
                            // Set localTimezone if provided
                            localTimezone: localTimezone || slot.localTimezone || userTimezone || "UTC",
                        },
                    ];
                }
                return [slot];
            }
        }
        // Generate slots until we can't fit another in the range
        let currentStart = rangeStart.clone();
        // To prevent infinite loops, set a reasonable maximum number of slots
        const maxSlots = 1000; // Arbitrary safety limit
        let slotCount = 0;
        console.log(`[SLOT_GENERATION:DETAIL] Starting slot generation loop`);
        // Debug flag to track if we enter the loop
        let enteredLoop = false;
        // FIXED: Use isBefore instead of isSameOrBefore to ensure we stop at the right time
        // Make sure we can fit the entire meeting duration within the remaining time
        // Use adaptedMeetingDuration instead of fixed meetingDuration
        while (currentStart
            .clone()
            .add(adaptedMeetingDuration, "minutes")
            .isSameOrBefore(rangeEnd) &&
            slotCount < maxSlots) {
            enteredLoop = true;
            const slotEnd = currentStart
                .clone()
                .add(adaptedMeetingDuration, "minutes");
            // Keep track of local time for reporting
            const localStart = currentStart.format("YYYY-MM-DD HH:mm");
            const localEnd = slotEnd.format("YYYY-MM-DD HH:mm");
            console.log(`[SLOT_GENERATION:DETAIL] Generated slot ${slotCount + 1}: ${localStart} - ${localEnd} in ${userTimezone || "UTC"}`);
            // For local time slots, we need to create slots that are marked as local time
            // but we'll convert to ISO strings for consistency with existing code
            let slotStartISO, slotEndISO;
            if (isLocalTime && userTimezone) {
                // Format as ISO strings directly but preserve isLocalTime flag
                slotStartISO = currentStart.format("YYYY-MM-DDTHH:mm:ss");
                slotEndISO = slotEnd.format("YYYY-MM-DDTHH:mm:ss");
            }
            else {
                // Use ISO strings from the moment objects
                slotStartISO = currentStart.toISOString();
                slotEndISO = slotEnd.toISOString();
            }
            // FIXED: Create proper slot objects with consistent properties
            // Following the debug info from server/debug-endpoints.ts, slots generated from time ranges should have:
            // isTimeRange: false, isSpecificTime: true, fromTimeRange: true
            generatedSlots.push({
                start: slotStartISO,
                end: slotEndISO,
                // Generated slots should be specific times, not time ranges
                isTimeRange: false, // FIX: This should be false for specific times
                isAllDay: false, // Generated slots are not all-day
                isSpecificTime: true, // FIX: This should be true for specific times
                // IMPORTANT: Always ensure fromTimeRange is true for these generated slots when they come from a time range
                // FIXED: Simplified flag logic to ensure fromTimeRange is always true for slots generated from time ranges
                fromTimeRange: true, // Always true for slots generated from time ranges
                fromAllDay: slot.isAllDay || slot.fromAllDay || false,
                // Track if we used an adapted duration for this slot
                adaptedDuration: isAdaptedDuration ? adaptedMeetingDuration : undefined,
                // No longer using isLocalTime flag - rely solely on sourceTimezone
                // When sourceTimezone is null/undefined, it's treated as local time
                sourceTimezone: slot.sourceTimezone,
                // Keep original start/end times for reference if they were in the original slot
                originalStart: slot.originalStart,
                originalEnd: slot.originalEnd,
                // Set localTimezone if provided
                localTimezone: localTimezone || slot.localTimezone || userTimezone,
            });
            // Move to next interval
            currentStart.add(slotInterval, "minutes");
            slotCount++;
        }
        // Check if we never entered the loop
        if (!enteredLoop) {
            console.log(`[SLOT_GENERATION:ERROR] Loop condition failed: first slot wouldn't end before range end`);
            console.log(`[SLOT_GENERATION:ERROR] First potential end time: ${rangeStart
                .clone()
                .add(meetingDuration, "minutes")
                .format("YYYY-MM-DD HH:mm")}`);
            console.log(`[SLOT_GENERATION:ERROR] Range end: ${rangeEnd.format("YYYY-MM-DD HH:mm")}`);
            console.log(`[SLOT_GENERATION:ERROR] Comparison: ${rangeStart
                .clone()
                .add(meetingDuration, "minutes")
                .isSameOrBefore(rangeEnd)}`);
            // IMPROVED: If we couldn't generate slots but the range is valid,
            // create at least one slot that fits within the range
            // For email time ranges, respect them regardless of minimum duration
            if (isEmailTimeRange || durationMinutes >= 25) {
                // For email time ranges, always respect the exact time, otherwise use minimum threshold of 25 minutes
                console.log("[SLOT_GENERATION:RECOVERY] Creating at least one slot that fits within the range");
                // Determine appropriate duration:
                // 1. For email time ranges, always use the exact duration (respect user's intent)
                // 2. Otherwise, use adapted duration if available
                // 3. Or use the full range duration if it's shorter than meeting duration
                // 4. Fall back to meeting duration as the last resort
                const useDuration = isEmailTimeRange
                    ? durationMinutes
                    : isAdaptedDuration
                        ? adaptedMeetingDuration
                        : durationMinutes < meetingDuration
                            ? durationMinutes
                            : meetingDuration;
                // For email time ranges with very short duration, make sure we don't create slots shorter than 10 minutes
                const finalDuration = isEmailTimeRange && useDuration < 10 ? 10 : useDuration;
                console.log(`[SLOT_GENERATION:RECOVERY] Using duration from ${isEmailTimeRange ? "email analysis" : "user preferences"}: ${finalDuration} minutes`);
                console.log(`[SLOT_GENERATION:RECOVERY] Using ${finalDuration} minutes for slot duration`);
                const slotEnd = rangeStart.clone().add(finalDuration, "minutes");
                let slotStartISO, slotEndISO;
                if (isLocalTime && userTimezone) {
                    slotStartISO = rangeStart.format("YYYY-MM-DDTHH:mm:ss");
                    slotEndISO = slotEnd.format("YYYY-MM-DDTHH:mm:ss");
                }
                else {
                    slotStartISO = rangeStart.toISOString();
                    slotEndISO = slotEnd.toISOString();
                }
                // Create UTC versions of the start and end times
                let startUTC = null;
                let endUTC = null;
                // Create local versions (user timezone) of start and end times
                let startLocal = null;
                let endLocal = null;
                // If we have a source timezone, convert between timezones properly
                if (slot.sourceTimezone) {
                    // Make sure we handle the case where sourceTimezone might be null or undefined
                    const safeTz = slot.sourceTimezone || "UTC";
                    const slotSourceTimezone = (0, timezone_utils_1.convertTimezoneAbbreviation)(safeTz) || safeTz;
                    // Source time (original timezone)
                    const startSource = slot.originalStart || slot.startSource || slotStartISO;
                    const endSource = slot.originalEnd || slot.endSource || slotEndISO;
                    // UTC time (for storage)
                    startUTC =
                        moment_timezone_1.default
                            .tz(slotStartISO, slotSourceTimezone)
                            .utc()
                            .format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    endUTC =
                        moment_timezone_1.default
                            .tz(slotEndISO, slotSourceTimezone)
                            .utc()
                            .format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    // Local time (user's timezone)
                    // Make sure userTimezone is treated as a string when we know it's defined
                    const userTz = userTimezone || "UTC"; // Provide a default value
                    startLocal = moment_timezone_1.default
                        .tz(slotStartISO, slotSourceTimezone)
                        .tz(userTz)
                        .format("YYYY-MM-DDTHH:mm:ss");
                    endLocal = moment_timezone_1.default
                        .tz(slotEndISO, slotSourceTimezone)
                        .tz(userTz)
                        .format("YYYY-MM-DDTHH:mm:ss");
                }
                else if (userTimezone) {
                    // If no source timezone but we have user timezone, assume times are in user timezone
                    startLocal = slotStartISO;
                    endLocal = slotEndISO;
                    // Convert from user timezone to UTC
                    startUTC =
                        moment_timezone_1.default
                            .tz(slotStartISO, userTimezone)
                            .utc()
                            .format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    endUTC =
                        moment_timezone_1.default
                            .tz(slotEndISO, userTimezone)
                            .utc()
                            .format("YYYY-MM-DDTHH:mm:ss") + "Z";
                }
                else {
                    // Fallback: Treat as UTC
                    startUTC =
                        moment_timezone_1.default.utc(slotStartISO).format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    endUTC = moment_timezone_1.default.utc(slotEndISO).format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    startLocal = slotStartISO;
                    endLocal = slotEndISO;
                }
                // Add timezone abbreviation for display
                const localTimeAbbreviation = userTimezone
                    ? getTimezoneAbbreviation(userTimezone)
                    : "UTC";
                generatedSlots.push({
                    // Basic slot properties (backward compatibility)
                    start: slotStartISO,
                    end: slotEndISO,
                    // Full timezone variations
                    startUTC: startUTC,
                    endUTC: endUTC,
                    startLocal: startLocal,
                    endLocal: endLocal,
                    startSource: slot.originalStart || slot.startSource || slotStartISO,
                    endSource: slot.originalEnd || slot.endSource || slotEndISO,
                    // Timezone information
                    sourceTimezone: slot.sourceTimezone,
                    localTimezone: localTimezone || slot.localTimezone || userTimezone,
                    LocalTime: localTimeAbbreviation,
                    // Slot type flags
                    isTimeRange: false, // FIX: This should be false for specific times
                    isAllDay: false,
                    isSpecificTime: true, // FIX: This should be true for specific times
                    // Provenance flags
                    fromTimeRange: true, // Always true for slots generated from time ranges
                    fromAllDay: slot.isAllDay || slot.fromAllDay || false,
                    // Additional metadata
                    adaptedDuration: useDuration !== meetingDuration ? useDuration : undefined,
                    originalStart: slot.originalStart,
                    originalEnd: slot.originalEnd,
                });
                console.log(`[SLOT_GENERATION:RECOVERY] Added one recovery slot: ${slotStartISO} - ${slotEndISO}`);
                console.log(`[SLOT_GENERATION:RECOVERY] Slot flags: isTimeRange=false, isSpecificTime=true, fromTimeRange=${slot.isTimeRange === true ? true : slot.fromTimeRange || false}`);
            }
        }
        if (slotCount >= maxSlots) {
            console.warn("[SLOT_GENERATION:WARNING] Maximum slot limit reached, may indicate an issue with input data");
        }
        // FIXED: If we still couldn't generate any slots, return the original
        if (generatedSlots.length === 0) {
            console.log("[SLOT_GENERATION:ERROR] No slots were generated, returning original slot");
            return [slot];
        }
        console.log(`[SLOT_GENERATION:SUCCESS] Generated ${generatedSlots.length} slots from time range ${slot.start} - ${slot.end}`);
        // Log a sample of generated slots
        generatedSlots.slice(0, 3).forEach((genSlot, idx) => {
            console.log(`[SLOT_GENERATION:DETAIL] Sample slot ${idx + 1}: ${genSlot.start} - ${genSlot.end}, flags: isTimeRange=${genSlot.isTimeRange}, isSpecificTime=${genSlot.isSpecificTime}, fromTimeRange=${genSlot.fromTimeRange}, sourceTimezone: ${genSlot.sourceTimezone || "local"}`);
        });
        if (generatedSlots.length > 3) {
            console.log(`[SLOT_GENERATION:DETAIL] ... and ${generatedSlots.length - 3} more slots`);
        }
    }
    catch (error) {
        console.error("[SLOT_GENERATION:ERROR] Error generating slots from time range:", error);
        return [slot]; // Return original on error
    }
    return generatedSlots.length > 0 ? generatedSlots : [slot];
}
