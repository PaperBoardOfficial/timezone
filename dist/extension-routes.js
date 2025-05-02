"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateShorterSlotsFromRange = void 0;
exports.registerExtensionRoutes = registerExtensionRoutes;
const openai_1 = __importDefault(require("openai"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const google_calendar_utils_1 = require("./google-calendar-utils");
const googleapis_1 = require("googleapis");
const nanoid_1 = require("nanoid");
const email_analysis_prompt_1 = require("../email-analysis-prompt");
const timezone_utils_1 = require("../timezone-utils");
const timezone_response_fix_1 = require("./timezone-response-fix");
const timezone_conversion_service_1 = require("../timezone-conversion-service");
Object.defineProperty(exports, "generateShorterSlotsFromRange", { enumerable: true, get: function () { return timezone_conversion_service_1.generateShorterSlotsFromRange; } });
/**
 * Helper function to convert slots from the timezone conversion service to our local Slot type
 * with proper metadata field calculations
 * @param slots Array of slots from the timezone conversion service
 * @returns Array of slots in our local Slot type format with complete metadata
 */
function convertToLocalSlotType(slots) {
    return slots.map((slot) => {
        // First extract the time portions from startLocal and endLocal if available
        const startLocalTime = slot.startLocal
            ? (0, moment_timezone_1.default)(slot.startLocal).format("HH:mm")
            : null;
        const endLocalTime = slot.endLocal
            ? (0, moment_timezone_1.default)(slot.endLocal).format("HH:mm")
            : null;
        // Get the date from start or current date as fallback
        const date = slot.start
            ? (0, moment_timezone_1.default)(slot.start).format("YYYY-MM-DD")
            : (0, moment_timezone_1.default)().format("YYYY-MM-DD");
        // Determine source timezone (fallback to localTimezone or UTC)
        const sourceTz = slot.sourceTimezone || slot.localTimezone || "UTC";
        const localTz = slot.localTimezone || "UTC";
        // Calculate originalStart if null
        let calculatedOriginalStart = slot.originalStart;
        if (startLocalTime &&
            (calculatedOriginalStart === null ||
                calculatedOriginalStart === undefined)) {
            try {
                // Convert local time back to source timezone
                const conversion = (0, timezone_conversion_service_1.convertTimezoneSafe)(date, startLocalTime, localTz, sourceTz);
                calculatedOriginalStart = conversion.convertedTime;
            }
            catch (error) {
                console.error("Error calculating originalStart:", error);
                calculatedOriginalStart = startLocalTime; // Fallback to local time
            }
        }
        // Calculate originalEnd if null
        let calculatedOriginalEnd = slot.originalEnd;
        if (endLocalTime &&
            (calculatedOriginalEnd === null || calculatedOriginalEnd === undefined)) {
            try {
                // Convert local time back to source timezone
                const conversion = (0, timezone_conversion_service_1.convertTimezoneSafe)(date, endLocalTime, localTz, sourceTz);
                calculatedOriginalEnd = conversion.convertedTime;
            }
            catch (error) {
                console.error("Error calculating originalEnd:", error);
                calculatedOriginalEnd = endLocalTime; // Fallback to local time
            }
        }
        // Remove the fields we don't want to include
        const { LocalTime, startSource, endSource, ...otherProps } = slot;
        // Create a new slot object with explicit type definition
        const updatedSlot = {
            // Basic slot properties
            start: slot.start,
            end: slot.end,
            // Time format variations
            startLocal: slot.startLocal,
            endLocal: slot.endLocal,
            startUTC: slot.startUTC,
            endUTC: slot.endUTC,
            // Source information
            fromTimeRange: slot.fromTimeRange,
            sourceTimezone: slot.sourceTimezone,
            // Calculated originalStart/End values
            originalStart: calculatedOriginalStart,
            originalEnd: calculatedOriginalEnd,
            // Metadata
            isTimeRange: slot.isTimeRange,
            isAllDay: slot.isAllDay,
            isSpecificTime: true, // Always true for final slots
            localTimezone: slot.localTimezone,
            localTime: slot.localTime,
            // Include remaining properties from original slot (excluding the ones we removed)
            ...otherProps,
        };
        return updatedSlot;
    });
}
/**
 * Extract sender information directly from the email content
 * @param emailContent The raw email content to parse
 * @returns Object containing extracted email and name, or null if not found
 */
function extractSenderInfoFromEmail(emailContent) {
    if (!emailContent)
        return { email: null, name: null };
    // Common patterns for sender information in emails
    // 1. From: John Doe <john@example.com>
    const fromHeaderRegex = /From:\s*([^<\r\n]+)?<?([^\s<>@]+@[^\s<>@]+)>?/i;
    // 2. Email address anywhere in the text
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    // 3. Name <email> pattern anywhere
    const nameEmailRegex = /([^<\r\n]+)<([^\s<>@]+@[^\s<>@]+)>/;
    let senderEmail = null;
    let senderName = null;
    // Try the most specific pattern first (From header)
    const fromMatch = emailContent.match(fromHeaderRegex);
    if (fromMatch) {
        senderName = fromMatch[1] ? fromMatch[1].trim() : null;
        senderEmail = fromMatch[2] ? fromMatch[2].trim() : null;
    }
    // If no From header, try name-email pattern
    if (!senderEmail) {
        const nameEmailMatch = emailContent.match(nameEmailRegex);
        if (nameEmailMatch) {
            senderName = nameEmailMatch[1] ? nameEmailMatch[1].trim() : null;
            senderEmail = nameEmailMatch[2] ? nameEmailMatch[2].trim() : null;
        }
    }
    // Last resort: just find any email address
    if (!senderEmail) {
        const emailMatch = emailContent.match(emailRegex);
        if (emailMatch) {
            senderEmail = emailMatch[1] ? emailMatch[1].trim() : null;
        }
    }
    // If we have an email but no name, use the first part of the email as name
    if (senderEmail && !senderName) {
        senderName = senderEmail.split("@")[0];
    }
    console.log("Extracted sender info:", { senderEmail, senderName });
    return { email: senderEmail, name: senderName };
}
// ===== Date Parsing Utilities =====
/**
 * Convert weekday number (0-6) to ISO weekday format (1-7)
 */
const convertWorkDay = (day) => {
    const numDay = parseInt(day);
    return numDay === 0 ? "7" : day;
};
/**
 * Format time string to HH:mm format
 */
const formatTimeString = (time) => {
    return time.split(":").slice(0, 2).join(":"); // Take only HH:mm part
};
/**
 * Parse a date string with multiple fallback strategies
 * Handles various formats including relative time references
 *
 * @param dateString Raw date string to parse
 * @returns Date object if successful, null if parsing fails
 */
const parseFlexibleDate = (dateString) => {
    if (!dateString)
        return null;
    console.log("Attempting to parse date:", dateString);
    // First try direct parsing
    let parsedDate = new Date(dateString);
    if (!isNaN(parsedDate.getTime())) {
        console.log("Standard date parsing succeeded");
        // Validate the year even for standard parsing
        const currentYear = new Date().getFullYear();
        if (parsedDate.getFullYear() < currentYear - 5) {
            console.log(`Correcting implausible year ${parsedDate.getFullYear()} to current year ${currentYear}`);
            parsedDate.setFullYear(currentYear);
        }
        return parsedDate;
    }
    // Try to extract from common Gmail formats
    try {
        // Format: "Tue, Mar 4, 1:16 PM (1 day ago)"
        const gmailFormat = /([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+)(?:,\s+(\d{4}))?[^(]*(?:\(([^)]+)\))?/;
        const match = dateString.match(gmailFormat);
        if (match) {
            console.log("Gmail format detected, extracted parts:", match);
            const monthNames = {
                Jan: 0,
                Feb: 1,
                Mar: 2,
                Apr: 3,
                May: 4,
                Jun: 5,
                Jul: 6,
                Aug: 7,
                Sep: 8,
                Oct: 9,
                Nov: 10,
                Dec: 11,
            };
            // Extract year, month, day
            let year = match[4] ? parseInt(match[4], 10) : new Date().getFullYear();
            const month = monthNames[match[2]];
            const day = parseInt(match[3], 10);
            // If a relative time reference exists (e.g., "1 day ago")
            if (match[5] && match[5].includes("day ago")) {
                const daysAgo = parseInt(match[5], 10);
                if (!isNaN(daysAgo)) {
                    const today = new Date();
                    today.setDate(today.getDate() - daysAgo);
                    return today;
                }
            }
            if (month !== undefined && !isNaN(day)) {
                // Validate year (ensure it's not implausibly in the past)
                const currentYear = new Date().getFullYear();
                if (year < currentYear - 5) {
                    year = currentYear;
                }
                return new Date(year, month, day);
            }
        }
    }
    catch (error) {
        console.warn("Error in flexible date parsing:", error);
    }
    return null;
};
// getCurrentDate is now imported from ./prompts/email-analysis-prompt
/**
 * Formats date/time values consistently for Google Calendar API
 * Ensures both start and end times use the same format (dateTime)
 *
 * @param date Date object or ISO string
 * @param timezone User's timezone
 * @returns Properly formatted object for Google Calendar API
 */
const formatForCalendar = (date, timezone = "UTC") => {
    let isoString;
    if (date instanceof Date) {
        // Convert Date object to ISO string without trailing Z
        isoString = date.toISOString().split(".")[0];
    }
    else {
        // Ensure string dates don't have trailing Z
        isoString = date.endsWith("Z") ? date.slice(0, -1) : date;
    }
    return {
        dateTime: isoString,
        timeZone: timezone,
    };
};
// ===== OpenAI Integration =====
// createSystemPrompt, dateExtractionSchema, and processSuggestedSlots are now imported from ./prompts/email-analysis-prompt
/**
 * Check if the user is authenticated
 * @param req Express request object
 * @returns Boolean indicating if the user is authenticated
 */
const isUserAuthenticated = (req) => {
    // Check if publicAccess flag is present in the request object or body (for testing)
    const hasPublicAccess = req.publicAccess === true || (req.body && req.body.publicAccess === true);
    // First, check if the isAuthenticated function is available (it should be with Passport)
    const hasAuthFunction = typeof req.isAuthenticated === "function";
    // Next, check if the user is authenticated using the function
    const isAuthViaFunction = hasAuthFunction ? req.isAuthenticated() : false;
    // Also check if user object exists in the request (should be set by Passport)
    const hasUserObject = !!req.user;
    // Check if there's a session ID
    const hasSessionID = !!req.sessionID;
    // Log authentication state for debugging
    console.log(`Authentication check: function=${hasAuthFunction}, authResult=${isAuthViaFunction}, hasUser=${hasUserObject}, hasSessionID=${hasSessionID}, publicAccess=${hasPublicAccess}`);
    // Return true if either:
    // 1. Both auth function says yes AND user object exists, or
    // 2. Public access flag is set for testing
    return (isAuthViaFunction && hasUserObject) || hasPublicAccess;
};
// The getTimezoneAbbreviation function is now imported from ./timezone-conversion-service
// ===== API Route Handlers =====
/**
 * Handler for analyzing email content
 * Extracts dates and times, generates suggested meeting slots, and filters by preferences
 *
 * @param req Express request
 * @param res Express response
 */
const handleAnalyzeEmail = async (req, res) => {
    var _a, _b;
    // First check authentication before anything else
    // Check if user is authenticated using session
    console.log("Authentication check for email analysis:", {
        isAuthenticated: isUserAuthenticated(req),
        hasUser: !!req.user,
        sessionID: req.sessionID,
        cookies: req.headers.cookie ? "Present" : "None",
        providedUserId: req.body.userId || "Not provided",
        method: req.method,
        path: req.path,
        origin: req.headers.origin,
    });
    // Special handling for Chrome extension requests - we know they come from the extension
    const isChromeExtension = req.headers.origin && req.headers.origin.startsWith("chrome-extension://");
    // Log more details about the auth state
    if (isChromeExtension) {
        console.log("Chrome extension request details:", {
            sessionCookie: req.headers.cookie,
            sessionID: req.sessionID,
            hasSession: !!req.session,
        });
    }
    // Require authentication for all requests
    if (!isUserAuthenticated(req)) {
        console.log("User is not authenticated via session cookie");
        return res.status(401).json({
            success: false,
            error: "Unauthorized",
            message: "Authentication is required to access this feature",
            slotsFound: false,
            foundDates: false,
            extracted: {
                dates: [],
                event_title: "Meeting",
                email_reply: "Thanks for your email.",
            },
            slots: {
                high: [],
                medium: [],
                low: [],
                aiGenerated: [],
            },
            event_title: "Meeting",
            email_reply: "Thanks for your email.",
        });
    }
    // Now that we've verified authentication, extract request data
    const { content, emailContent, receivedDate, userId } = req.body;
    // Use either content or emailContent field (for backward compatibility)
    const emailContentToAnalyze = content || emailContent;
    // Early validation - return 400 if no email content provided
    if (!emailContentToAnalyze) {
        return res.status(400).json({
            success: false,
            slotsFound: false,
            foundDates: false,
            error: "Missing email content",
            message: "Please provide email content for analysis",
            extracted: {
                dates: [],
                event_title: "Meeting",
                email_reply: "Thanks for your email.",
            },
            slots: {
                high: [],
                medium: [],
                low: [],
                aiGenerated: [],
            },
            event_title: "Meeting",
            email_reply: "Thanks for your email.",
        });
    }
    // Initialize data with default values
    let extractedData = {
        dates: [],
        times: [],
        event_title: "Meeting",
        email_reply: "Thank you for your email. I'm proposing the following meeting time.",
        meeting_duration: null,
        timezone: null,
    };
    let suggestedSlots = [];
    let userPreferences = null;
    let userTimezone = "UTC";
    let extractedTimezone = null; // Store the timezone extracted from the email
    let isReplyMode = false;
    try {
        // Get the authenticated user
        const user = req.user;
        // Parse the received date if provided (for better context in relative date references)
        let referenceDate = (0, email_analysis_prompt_1.getCurrentDate)();
        if (receivedDate) {
            const parsedReceivedDate = parseFlexibleDate(receivedDate);
            if (parsedReceivedDate) {
                referenceDate = parsedReceivedDate.toISOString().split("T")[0];
            }
        }
        console.log("Starting email analysis with reference date:", referenceDate);
        // Initialize OpenAI client
        const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
        // Extract dates from the email content using OpenAI
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: (0, email_analysis_prompt_1.createSystemPrompt)(referenceDate) },
                { role: "user", content: emailContentToAnalyze },
            ],
            temperature: 0.1,
            functions: [email_analysis_prompt_1.dateExtractionSchema],
            function_call: { name: "email_analysis" },
        });
        // Process OpenAI response
        const functionCall = response.choices[0].message.function_call;
        if (functionCall && functionCall.name === "email_analysis") {
            try {
                extractedData = JSON.parse(functionCall.arguments);
                console.log("Successfully parsed date/time data:", JSON.stringify(extractedData, null, 2));
                // Also convert individual time slot timezones
                if (extractedData &&
                    extractedData.dates &&
                    extractedData.dates.length > 0) {
                    extractedData.dates.forEach((dateInfo) => {
                        if (dateInfo.times && dateInfo.times.length > 0) {
                            dateInfo.times.forEach((timeInfo) => {
                                // Convert individual slot timezone to IANA format if it exists
                                if (timeInfo.sourceTimezone) {
                                    timeInfo.sourceTimezone =
                                        (0, timezone_utils_1.convertTimezoneAbbreviation)(timeInfo.sourceTimezone) ||
                                            timeInfo.sourceTimezone;
                                }
                            });
                        }
                    });
                }
                // IMPORTANT: Process the extracted times and ensure timezone info is properly handled
                // We should not override the per-slot sourceTimezone with a global value
                if (extractedData &&
                    extractedData.dates &&
                    extractedData.dates.length > 0) {
                    console.log(`Processing extracted times with userTimezone: ${userTimezone}`);
                    // Extract a default timezone from the email if one is commonly used
                    let mostCommonTimezone = null;
                    let timezoneCount = {};
                    // Count occurrences of each timezone to find the most common one
                    extractedData.dates.forEach((dateInfo) => {
                        if (dateInfo.times && dateInfo.times.length > 0) {
                            dateInfo.times.forEach((timeInfo) => {
                                if (timeInfo.sourceTimezone) {
                                    timezoneCount[timeInfo.sourceTimezone] =
                                        (timezoneCount[timeInfo.sourceTimezone] || 0) + 1;
                                }
                            });
                        }
                    });
                    // Find the most common timezone if any exist
                    let maxCount = 0;
                    for (const [tz, count] of Object.entries(timezoneCount)) {
                        if (count > maxCount) {
                            maxCount = count;
                            mostCommonTimezone = tz;
                        }
                    }
                    // Update the global extractedTimezone for debugging and display
                    if (mostCommonTimezone) {
                        extractedTimezone = mostCommonTimezone;
                        console.log(`Found most common timezone in email: ${extractedTimezone}`);
                    }
                    // Process each time slot, preserving individual sourceTimezone values
                    extractedData.dates.forEach((dateInfo) => {
                        if (dateInfo.times && dateInfo.times.length > 0) {
                            dateInfo.times.forEach((timeInfo) => {
                                // If a time has no timezone but we found a common one, use that
                                if (!timeInfo.sourceTimezone && mostCommonTimezone) {
                                    timeInfo.sourceTimezone = mostCommonTimezone;
                                    console.log(`Applied common timezone ${mostCommonTimezone} to a time slot without timezone`);
                                }
                                // Remove isLocalTime property entirely as we'll rely solely on sourceTimezone
                                if (timeInfo.hasOwnProperty("isLocalTime")) {
                                    delete timeInfo.isLocalTime;
                                }
                                // Store the original extracted times before any conversion
                                if (!timeInfo.originalStart) {
                                    timeInfo.originalStart = timeInfo.start;
                                }
                                if (!timeInfo.originalEnd) {
                                    timeInfo.originalEnd = timeInfo.end;
                                }
                                // Log the sourceTimezone for each slot for debugging
                                console.log(`Time slot ${timeInfo.start}-${timeInfo.end} sourceTimezone: ${timeInfo.sourceTimezone || "None (Local Time)"}`);
                                console.log(`Original extracted times: ${timeInfo.originalStart}-${timeInfo.originalEnd}`);
                            });
                        }
                    });
                }
            }
            catch (parseError) {
                console.error("Error parsing OpenAI function response:", parseError);
                extractedData = {
                    dates: [],
                    times: [],
                    event_title: "Meeting",
                    email_reply: "Thanks for your email. I'd like to schedule a meeting with you.",
                    meeting_duration: null,
                };
            }
        }
        else {
            console.warn("No function call in OpenAI response");
            extractedData = {
                dates: [],
                times: [],
                event_title: "Meeting",
                email_reply: "Thanks for your email. I'd like to schedule a meeting with you.",
                meeting_duration: null,
            };
        }
        // Use the new centralized timezone conversion service for processing extracted dates
        // This handles all timezone conversions in a consistent way
        const processedResult = (0, timezone_conversion_service_1.processEmailAnalysisWithTimezones)(extractedData, userTimezone, extractedData.meeting_duration || null, 60 // Default slot interval
        );
        // Update extracted data with timezone-converted times
        extractedData = processedResult.extractedData;
        // Use candidate slots generated by the timezone conversion service
        suggestedSlots = processedResult.candidateSlots;
        // Determine if this is a reply mode based on the extracted data
        isReplyMode =
            extractedData &&
                extractedData.dates &&
                extractedData.dates.some((d) => d.times && d.times.length > 0);
        console.log("Is reply mode:", isReplyMode);
        console.log("Extracted timezone:", extractedTimezone || "Not found");
        console.log("User timezone:", userTimezone);
        console.log("Initial suggested slots:", JSON.stringify(suggestedSlots, null, 2));
        // STEP 1: Filter out past slots
        // STEP 2: Get user preferences
        const userPreferencesResult = await getUserPreferences(user.id);
        userPreferences = userPreferencesResult.preferences;
        userTimezone = user.timezone || userPreferencesResult.timezone;
        // STEP 3: Process slots through the new pipeline-based filtering system
        if (suggestedSlots.length > 0) {
            console.log(`Starting slot filtering pipeline with ${suggestedSlots.length} initial slots`);
            // Process through the pipeline with different logic for reply mode vs. new email mode
            // FIXED: Pre-process all slots to ensure consistent flags for time ranges
            console.log("Pre-processing slots to ensure consistent flags for time ranges");
            suggestedSlots = suggestedSlots.map((slot) => {
                // Check both isTimeRange and fromTimeRange to handle all cases
                if (slot.isTimeRange === true) {
                    // Original time range slots should have fromTimeRange=true
                    slot.fromTimeRange = true;
                    console.log(`Fixed flags for time range slot: ${slot.start} - ${slot.end}`);
                }
                // For slots already marked as fromTimeRange, make sure isTimeRange is set consistently
                else if (slot.fromTimeRange === true) {
                    // Slots marked as fromTimeRange should be specific times, not time ranges
                    slot.isTimeRange = false;
                    slot.isSpecificTime = true;
                    console.log(`Fixed flags for derived slot: ${slot.start} - ${slot.end}`);
                }
                // Slots with isSpecificTime=true should have isTimeRange=false
                if (slot.isSpecificTime === true) {
                    slot.isTimeRange = false;
                }
                return slot;
            });
            if (isReplyMode) {
                console.log("Reply mode: Using pipeline filtering approach");
                // For reply mode, we process through the full pipeline at once
                suggestedSlots = await processSlotsThroughPipeline(suggestedSlots, user, userPreferences, userTimezone, true, // Enable debug mode to see detailed conflict information
                extractedData.meeting_duration // Pass the meeting duration extracted from email
                );
                console.log(`Reply mode: After pipeline filtering: ${suggestedSlots.length} slots available`);
                if (suggestedSlots.length === 0) {
                    console.log("No slots available after filtering pipeline. Respecting user's preferences and calendar conflicts.");
                }
            }
            else {
                // For non-reply mode, also use the pipeline approach
                console.log("Standard mode: Using pipeline filtering approach");
                suggestedSlots = await processSlotsThroughPipeline(suggestedSlots, user, userPreferences, userTimezone, true, // Enable debug mode to see detailed conflict information
                extractedData.meeting_duration // Pass the meeting duration extracted from email
                );
                console.log(`Standard mode: After pipeline filtering: ${suggestedSlots.length} slots available`);
            }
        }
        // STEP 5: Generate response data
        // Create a unique ID for the slot link
        const linkId = (0, nanoid_1.nanoid)();
        // Check if we found any dates or slots
        const foundDates = extractedData.dates && extractedData.dates.length > 0;
        const slotsFound = suggestedSlots.length > 0;
        // Extract sender information from the email content
        const extractedSenderInfo = extractSenderInfoFromEmail(emailContentToAnalyze);
        const senderEmail = extractedSenderInfo.email;
        const senderName = extractedSenderInfo.name;
        // The timezone-conversion-service.ts has already provided a complete slot structure
        // with all required timezone information, no need to perform additional conversions
        if (suggestedSlots.length > 0) {
            console.log(`Using ${suggestedSlots.length} fully processed slots from timezone-conversion-service.`);
            // Log a few sample slots for debugging
            if (suggestedSlots.length > 0) {
                console.log("Sample slot data:", JSON.stringify(suggestedSlots[0], null, 2));
            }
        }
        let recommendedSlot = null;
        if (suggestedSlots.length > 0) {
            // Find the best slot based on time preference (AM/PM)
            // Explicitly type bestSlot to match EnhancedSlot type to avoid TypeScript errors
            let bestSlot = suggestedSlots[0]; // Default to first slot
            // Check user's time preference
            const timePreference = userPreferences.timePreference || "both";
            if (timePreference !== "both") {
                // Use moment-timezone to correctly determine if a slot is AM or PM in user's timezone
                const isAM = (dateStr) => {
                    // Convert UTC time to user's timezone
                    const localHour = moment_timezone_1.default.tz(dateStr, userTimezone).hour();
                    console.log(`Slot ${dateStr} is at local hour ${localHour} in ${userTimezone}`);
                    return localHour < 12;
                };
                // Find the first slot that matches the preference
                const preferredSlot = suggestedSlots.find((slot) => {
                    if (timePreference === "am") {
                        return isAM(slot.start);
                    }
                    else {
                        // pm
                        return !isAM(slot.start);
                    }
                });
                // Use the preferred slot if found
                if (preferredSlot) {
                    const localTime = moment_timezone_1.default
                        .tz(preferredSlot.start, userTimezone)
                        .format("HH:mm");
                    console.log(`Using ${timePreference} preferred slot at local time ${localTime} instead of first available slot`);
                    bestSlot = preferredSlot;
                }
                else {
                    console.log(`No ${timePreference} slots available in timezone ${userTimezone}, using first available slot`);
                }
            }
            // Get timezone abbreviation for the user's timezone (for the recommended slot)
            const timezoneAbbreviation = (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone);
            // Check if the bestSlot comes from a time range expansion
            const isFromTimeRange = bestSlot.isTimeRange === true || bestSlot.fromTimeRange === true;
            console.log(`Selected bestSlot is from time range: ${isFromTimeRange}`);
            // IMPORTANT: For slots expanded from time ranges, we want to use the individual
            // slot's start/end times, not restore the original time range's boundaries
            let startSource, endSource;
            if (isFromTimeRange) {
                // If this is from a time range, use the current slot's times
                // rather than the original time range boundaries
                startSource =
                    ((_a = bestSlot.start.split("T")[1]) === null || _a === void 0 ? void 0 : _a.substring(0, 5)) || bestSlot.start;
                endSource = ((_b = bestSlot.end.split("T")[1]) === null || _b === void 0 ? void 0 : _b.substring(0, 5)) || bestSlot.end;
                console.log(`Using individual slot times (not original time range): ${startSource} - ${endSource}`);
            }
            else {
                // Regular case for non-time-range slots
                startSource =
                    bestSlot.originalStart || bestSlot.startSource || bestSlot.start;
                endSource = bestSlot.originalEnd || bestSlot.endSource || bestSlot.end;
            }
            // For UTC times, we need different handling based on source timezone
            let startUTC, endUTC;
            let startLocal, endLocal;
            // Get the sourceTimezone from bestSlot if it exists
            const slotSourceTimezone = bestSlot.sourceTimezone;
            // Get local timezone abbreviation for comparison
            const localTimeAbbreviation = (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone);
            // Special case: if sourceTimezone equals user's local timezone abbreviation, treat it as local time
            if (slotSourceTimezone && slotSourceTimezone !== localTimeAbbreviation) {
                // For slots with a true source timezone (different from local), we need to:
                // 1. Parse the date+time properly using the source timezone
                // 2. Convert to UTC
                // 3. Convert to user's local timezone
                // First construct the proper date-time string with the original times
                // Format: YYYY-MM-DDTHH:MM:SS in source timezone
                const datePart = bestSlot.start.split("T")[0]; // Extract the date part
                const sourceStartStr = `${datePart}T${startSource}:00`;
                const sourceEndStr = endSource
                    ? `${datePart}T${endSource}:00`
                    : bestSlot.end;
                // Convert from source timezone to UTC
                startUTC = moment_timezone_1.default.tz(sourceStartStr, slotSourceTimezone).utc().format();
                endUTC = moment_timezone_1.default.tz(sourceEndStr, slotSourceTimezone).utc().format();
                // Convert from source timezone to user's local timezone
                // Add safety for undefined userTimezone
                const safeUserTz = userTimezone || "UTC";
                // First get the moment objects in the user's timezone
                const localStartMoment = moment_timezone_1.default
                    .tz(sourceStartStr, slotSourceTimezone)
                    .tz(safeUserTz);
                const localEndMoment = moment_timezone_1.default
                    .tz(sourceEndStr, slotSourceTimezone)
                    .tz(safeUserTz);
                // Format with proper local time format (no Z suffix)
                startLocal = localStartMoment.format("YYYY-MM-DDTHH:mm:ss");
                endLocal = localEndMoment.format("YYYY-MM-DDTHH:mm:ss");
                // Log actual conversion to ensure it's working correctly
                console.log(`TIMEZONE CONVERSION DEBUG:
          - Source time: ${sourceStartStr} in ${slotSourceTimezone}
          - Local time: ${startLocal} in ${safeUserTz}
          - UTC offset difference: ${localStartMoment.utcOffset() / 60} hours`);
                console.log(`TIMEZONE CONVERSION DETAIL - WITH SOURCE TIMEZONE:`);
                console.log(`  - Source timezone: ${slotSourceTimezone}`);
                console.log(`  - User timezone: ${userTimezone}`);
                console.log(`  - Original time: ${startSource}`);
                console.log(`  - UTC time: ${startUTC}`);
                console.log(`  - Local time: ${startLocal}`);
                console.log(`  - Local timezone abbreviation: ${(0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone)}`);
            }
            else {
                // If no sourceTimezone, we still need to make sure we're properly converting to local time
                // Assume the times are in user's timezone already, but verify and handle properly
                const safeUserTimezone = userTimezone || "UTC";
                // Parse the start/end times and ensure they're treated as being in user's timezone
                // Then properly format them without Z suffix
                const localStartMoment = moment_timezone_1.default.tz(bestSlot.start, safeUserTimezone);
                const localEndMoment = moment_timezone_1.default.tz(bestSlot.end, safeUserTimezone);
                startLocal = localStartMoment.format("YYYY-MM-DDTHH:mm:ss");
                endLocal = localEndMoment.format("YYYY-MM-DDTHH:mm:ss");
                // Log for debugging purposes
                console.log(`TIMEZONE CONVERSION DEBUG (no source timezone):
          - Original time: ${bestSlot.start} (assumed to be in ${safeUserTimezone})
          - Formatted local time: ${startLocal}
          - UTC offset of user timezone: ${localStartMoment.utcOffset() / 60} hours`);
                // Convert from user's local timezone to UTC for storage
                // safeUserTimezone is already defined above
                startUTC = moment_timezone_1.default.tz(bestSlot.start, safeUserTimezone).utc().format();
                endUTC = moment_timezone_1.default.tz(bestSlot.end, safeUserTimezone).utc().format();
                console.log(`TIMEZONE CONVERSION DETAIL - NO SOURCE TIMEZONE (ASSUMING LOCAL TIME):`);
                console.log(`  - User timezone: ${userTimezone}`);
                console.log(`  - Original time (local): ${startSource}`);
                console.log(`  - Local time: ${startLocal}`);
                console.log(`  - Local timezone abbreviation: ${(0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone)}`);
            }
            // Create the initial recommended slot object with proper format consistency
            // We'll use the exact same format as the slots.high array
            recommendedSlot = {
                // Use local time format for both start/end
                start: startLocal,
                end: endLocal,
                // Time format variations - consistently using local timezone format
                startLocal: startLocal,
                endLocal: endLocal,
                startUTC: startUTC,
                endUTC: endUTC,
                // Source information
                fromTimeRange: isFromTimeRange,
                sourceTimezone: slotSourceTimezone,
                startSource: startSource,
                endSource: endSource,
                // Preserve original times throughout the pipeline
                originalStart: startSource,
                originalEnd: endSource,
                // Metadata
                isTimeRange: false, // Always false for the recommended slot
                isAllDay: false,
                isSpecificTime: true,
                localTimezone: userTimezone,
                // Human-readable timezone abbreviation - include both formats for consistency
                localTime: timezoneAbbreviation,
                LocalTime: timezoneAbbreviation,
                // Additional information for the UI
                linkId,
                event_title: extractedData.event_title || "Meeting",
                email_reply: extractedData.email_reply || "Thanks for your email.",
                duration: extractedData.meeting_duration || null,
                attendeeEmail: senderEmail,
                attendeeName: senderName,
            };
            console.log("Created recommended slot:", recommendedSlot);
        }
        // Return the response with all data and debug information
        // Define interface for slot type to include sourceTimezone
        // Use the Slot interface that's already defined in this file
        // Enhance slots with complete timezone information for priority groups
        const slotsWithLocalTime = suggestedSlots.map((slot) => {
            // FIXED: Always ensure proper timezone conversion regardless of existing values
            // First convert any UTC times to userTimezone
            // Determine which time fields to use as the source of truth
            // If we have UTC times in the slot, use those for conversion (most reliable)
            let startDateTime = null;
            let endDateTime = null;
            if (slot.startUTC) {
                // If we have a UTC time, use it as source of truth for conversion
                startDateTime = moment_timezone_1.default.utc(slot.startUTC).tz(userTimezone);
            }
            else if (slot.start) {
                // Otherwise use the start time
                // If slot.start is a UTC time (ends with Z), properly convert it
                if (typeof slot.start === "string" && slot.start.endsWith("Z")) {
                    startDateTime = moment_timezone_1.default.utc(slot.start).tz(userTimezone);
                }
                else {
                    // Assume it's already in user timezone
                    startDateTime = moment_timezone_1.default.tz(slot.start, userTimezone);
                }
            }
            if (slot.endUTC) {
                // If we have a UTC time, use it as source of truth for conversion
                endDateTime = moment_timezone_1.default.utc(slot.endUTC).tz(userTimezone);
            }
            else if (slot.end) {
                // Otherwise use the end time
                // If slot.end is a UTC time (ends with Z), properly convert it
                if (typeof slot.end === "string" && slot.end.endsWith("Z")) {
                    endDateTime = moment_timezone_1.default.utc(slot.end).tz(userTimezone);
                }
                else {
                    // Assume it's already in user timezone
                    endDateTime = moment_timezone_1.default.tz(slot.end, userTimezone);
                }
            }
            // Format local times in user's timezone consistently
            const startLocalTime = startDateTime === null || startDateTime === void 0 ? void 0 : startDateTime.format("YYYY-MM-DDTHH:mm:ss");
            const endLocalTime = endDateTime === null || endDateTime === void 0 ? void 0 : endDateTime.format("YYYY-MM-DDTHH:mm:ss");
            // Ensure we have UTC times for storage and APIs
            const startUTCTime = (startDateTime === null || startDateTime === void 0 ? void 0 : startDateTime.clone().utc().format("YYYY-MM-DDTHH:mm:ss")) + "Z";
            const endUTCTime = (endDateTime === null || endDateTime === void 0 ? void 0 : endDateTime.clone().utc().format("YYYY-MM-DDTHH:mm:ss")) + "Z";
            // Debug information
            console.log(`[TIMEZONE DEBUG] Processing slot with user timezone: ${userTimezone}`);
            console.log(`[TIMEZONE DEBUG] Original slot.start: ${slot.start}`);
            console.log(`[TIMEZONE DEBUG] Original slot.startUTC: ${slot.startUTC}`);
            console.log(`[TIMEZONE DEBUG] Converted startLocalTime: ${startLocalTime}`);
            return {
                // Use local time format for both start/end
                start: startLocalTime,
                end: endLocalTime,
                // Time format variations - consistently using local timezone format
                startLocal: startLocalTime,
                endLocal: endLocalTime,
                startUTC: startUTCTime || slot.startUTC,
                endUTC: endUTCTime || slot.endUTC,
                // Source information
                fromTimeRange: !!slot.fromTimeRange,
                sourceTimezone: slot.sourceTimezone || extractedTimezone || null,
                startSource: slot.originalStart || slot.startSource || null,
                endSource: slot.originalEnd || slot.endSource || null,
                // Preserve original times throughout the pipeline
                originalStart: slot.originalStart || null,
                originalEnd: slot.originalEnd || null,
                // Metadata
                isTimeRange: !!slot.isTimeRange,
                isAllDay: !!slot.isAllDay,
                isSpecificTime: !!slot.isSpecificTime,
                localTimezone: slot.localTimezone || userTimezone,
                // Human-readable timezone abbreviation - include both lowercase and uppercase formats
                // for complete consistency with recommendedSlot
                localTime: slot.localTime || (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone),
                LocalTime: slot.LocalTime || (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone),
            };
        });
        // Just log a sample slot for debugging
        if (suggestedSlots.length > 0) {
            const sampleSlot = suggestedSlots[0];
            console.log(`TIMEZONE DEBUG - Using fully processed slot:`, {
                start: sampleSlot.start,
                end: sampleSlot.end,
                startSource: sampleSlot.startSource || sampleSlot.start,
                endSource: sampleSlot.endSource || sampleSlot.end,
                startUTC: sampleSlot.startUTC || "not available",
                endUTC: sampleSlot.endUTC || "not available",
                startLocal: sampleSlot.startLocal || "not available",
                endLocal: sampleSlot.endLocal || "not available",
                sourceTimezone: sampleSlot.sourceTimezone,
                userTimezone,
            });
        }
        // Process the extractedData to preserve sourceTimezone fields
        const processedExtractedData = (0, timezone_response_fix_1.preserveSourceTimezone)(extractedData);
        // Create a detailed log of the timezone conversion flow for debugging
        console.log(`\n=== TIMEZONE CONVERSION FLOW SUMMARY ===`);
        console.log(`User timezone: ${userTimezone} (${(0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone)})`);
        console.log(`Email timezone (if detected): ${extractedTimezone || "None detected"}`);
        if (recommendedSlot !== null) {
            console.log(`\nRecommended slot timezone details:`);
            console.log(`- Start original: ${recommendedSlot.startSource}`);
            console.log(`- Start UTC: ${recommendedSlot.startUTC}`);
            console.log(`- Start local: ${recommendedSlot.startLocal} (${recommendedSlot.localTime || recommendedSlot.LocalTime})`);
            console.log(`- Source timezone: ${recommendedSlot.sourceTimezone || "None (local time assumed)"}`);
        }
        if (slotsWithLocalTime.length > 0) {
            console.log(`\nFirst suggested slot timezone details:`);
            const firstSlot = slotsWithLocalTime[0];
            console.log(`- Start original: ${firstSlot.startSource || firstSlot.start}`);
            console.log(`- Start UTC: ${firstSlot.startUTC || "Not available"}`);
            console.log(`- Start local: ${firstSlot.startLocal || "Not available"} (${firstSlot.localTime})`);
            console.log(`- Source timezone: ${firstSlot.sourceTimezone || "None (local time assumed)"}`);
        }
        console.log(`=== END TIMEZONE CONVERSION FLOW SUMMARY ===\n`);
        return res.json({
            success: true,
            slotsFound,
            extracted: {
                dates: processedExtractedData.dates || [],
                event_title: processedExtractedData.event_title || "Meeting",
                email_reply: processedExtractedData.email_reply || "Thanks for your email.",
                meeting_duration: processedExtractedData.meeting_duration || null,
            },
            // We no longer use priority tiers
            slots: slotsWithLocalTime,
            foundDates,
            event_title: extractedData.event_title || "Meeting",
            email_reply: extractedData.email_reply || "Thanks for your email.",
            // For reply mode, always prefer the first extracted slot
            slot: recommendedSlot,
            isReplyMode,
            preferences: userPreferences,
            timezone: userTimezone,
            // Add debug information about processing steps
            debug: {
                // Store the original slots before any pipeline processing
                initialSlots: convertToLocalSlotType((0, timezone_conversion_service_1.processEmailAnalysisWithTimezones)(extractedData, userTimezone, extractedData.meeting_duration || null, 60).candidateSlots),
                // IMPORTANT: The pipeline used for actual slot processing is different from the direct debug filtering
                // Direct debug filtering of initial slots - this is NOT what's used in the actual pipeline
                afterPastFiltering: filterPastSlots(convertToLocalSlotType((0, timezone_conversion_service_1.processEmailAnalysisWithTimezones)(extractedData, userTimezone, extractedData.meeting_duration || null, 60).candidateSlots)),
                // Clear notice about the pipeline order
                pipeline: "Used pipeline-based filtering with proper order for actual slot processing",
                pipelineOrder: [
                    "slot expansion",
                    "past filtering",
                    "working days",
                    "working hours",
                    "time preference",
                    "buffer alignment",
                    "calendar availability",
                ],
                calendarCheck: "Performed via pipeline",
                // Important: These final slots are the ones actually returned to the client after pipeline processing
                // Ensure all slots have complete timezone information with proper local times
                finalSlots: suggestedSlots.map((slot) => {
                    // FIXED: Apply the same robust conversion logic for debug slots
                    // First convert any UTC times to userTimezone
                    // Determine which time fields to use as the source of truth
                    // If we have UTC times in the slot, use those for conversion (most reliable)
                    let startDateTime = null;
                    let endDateTime = null;
                    if (slot.startUTC) {
                        // If we have a UTC time, use it as source of truth for conversion
                        startDateTime = moment_timezone_1.default.utc(slot.startUTC).tz(userTimezone);
                    }
                    else if (slot.start) {
                        // Otherwise use the start time
                        // If slot.start is a UTC time (ends with Z), properly convert it
                        if (typeof slot.start === "string" && slot.start.endsWith("Z")) {
                            startDateTime = moment_timezone_1.default.utc(slot.start).tz(userTimezone);
                        }
                        else {
                            // Assume it's already in user timezone
                            startDateTime = moment_timezone_1.default.tz(slot.start, userTimezone);
                        }
                    }
                    if (slot.endUTC) {
                        // If we have a UTC time, use it as source of truth for conversion
                        endDateTime = moment_timezone_1.default.utc(slot.endUTC).tz(userTimezone);
                    }
                    else if (slot.end) {
                        // Otherwise use the end time
                        // If slot.end is a UTC time (ends with Z), properly convert it
                        if (typeof slot.end === "string" && slot.end.endsWith("Z")) {
                            endDateTime = moment_timezone_1.default.utc(slot.end).tz(userTimezone);
                        }
                        else {
                            // Assume it's already in user timezone
                            endDateTime = moment_timezone_1.default.tz(slot.end, userTimezone);
                        }
                    }
                    // Format local times in user's timezone consistently
                    const startLocalTime = startDateTime === null || startDateTime === void 0 ? void 0 : startDateTime.format("YYYY-MM-DDTHH:mm:ss");
                    const endLocalTime = endDateTime === null || endDateTime === void 0 ? void 0 : endDateTime.format("YYYY-MM-DDTHH:mm:ss");
                    // Ensure we have UTC times for storage and APIs
                    const startUTCTime = (startDateTime === null || startDateTime === void 0 ? void 0 : startDateTime.clone().utc().format("YYYY-MM-DDTHH:mm:ss")) + "Z";
                    const endUTCTime = (endDateTime === null || endDateTime === void 0 ? void 0 : endDateTime.clone().utc().format("YYYY-MM-DDTHH:mm:ss")) + "Z";
                    return {
                        // Use local time format for both start/end
                        start: startLocalTime,
                        end: endLocalTime,
                        // Time format variations - consistently using local timezone format
                        startLocal: startLocalTime,
                        endLocal: endLocalTime,
                        startUTC: startUTCTime || slot.startUTC,
                        endUTC: endUTCTime || slot.endUTC,
                        // Source information
                        fromTimeRange: !!slot.fromTimeRange,
                        sourceTimezone: slot.sourceTimezone || extractedTimezone || null,
                        startSource: slot.originalStart || slot.startSource || null,
                        endSource: slot.originalEnd || slot.endSource || null,
                        // Preserve original times
                        originalStart: slot.originalStart || null,
                        originalEnd: slot.originalEnd || null,
                        // Metadata
                        isTimeRange: !!slot.isTimeRange,
                        isAllDay: !!slot.isAllDay,
                        isSpecificTime: !!slot.isSpecificTime,
                        localTimezone: slot.localTimezone || userTimezone,
                        // Human-readable timezone abbreviation - using both property names for backward compatibility
                        localTime: slot.localTime || (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone),
                        LocalTime: slot.LocalTime || (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone),
                    };
                }),
                processingDate: new Date().toISOString(),
                currentTime: {
                    utcTime: new Date().toISOString(),
                    utcHoursMinutes: `${new Date().getUTCHours()}:${String(new Date().getUTCMinutes()).padStart(2, "0")} UTC`,
                    timestamp: Date.now(),
                    bufferInMillis: (userPreferences.bufferTime || 15) * 60 * 1000,
                },
                timeChecks: {
                    userTimezone,
                    workingDays: userPreferences.workDays,
                    isThursdayWorkingDay: userPreferences.workDays.includes("4"),
                    timePreference: userPreferences.timePreference,
                },
            },
        });
    }
    catch (error) {
        // Handle any errors that occurred during processing
        console.error("Error analyzing email:", error);
        return res.status(500).json({
            success: false,
            slotsFound: false,
            foundDates: false,
            error: "Failed to analyze email",
            message: error.message || "Unknown error",
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
            extracted: {
                dates: [],
                event_title: "Meeting",
                email_reply: "Thanks for your email.",
                meeting_duration: null,
            },
            slots: {
                high: [],
                medium: [],
                low: [],
                aiGenerated: [],
            },
            event_title: "Meeting",
            email_reply: "Thanks for your email.",
            debug: {
                error: true,
                errorMessage: error.message || "Unknown error",
                processingDate: new Date().toISOString(),
            },
        });
    }
};
/**
 * Filter out slots that are in the past
 * @param slots Array of slots to filter
 * @param userTimezone User's timezone (needed for local time slots)
 * @returns Array of slots in the future
 */
function filterPastSlots(slots, userTimezone) {
    const now = new Date();
    // Add a small buffer (2 minutes) to avoid filtering slots that are very near in the future
    const bufferTime = 2 * 60 * 1000; // 2 minutes in milliseconds
    const nowPlusBuffer = new Date(now.getTime() + bufferTime);
    console.log(`[FILTER:PAST] Current time: ${now.toISOString()}, With buffer: ${nowPlusBuffer.toISOString()}`);
    console.log(`[FILTER:PAST] User timezone: ${userTimezone || "Not provided"}`);
    // FIXED: DO NOT add sourceTimezone when null - this is on purpose
    // A null sourceTimezone indicates that the time should be treated as
    // local time in the user's timezone and needs to be preserved
    // Filter out slots in the past
    const futureSlotsOnly = slots.filter((slot) => {
        // Special handling for local time slots (when sourceTimezone is the same as user's local timezone)
        const slotWithTimezone = slot;
        const localTimeAbbr = userTimezone
            ? (0, timezone_conversion_service_1.getTimezoneAbbreviation)(userTimezone)
            : "";
        if (slotWithTimezone.sourceTimezone === localTimeAbbr && userTimezone) {
            console.log(`[FILTER:PAST:LOCAL] Processing local time slot: ${slot.start} in ${userTimezone}`);
            // For local time slots, interpret the time in the user's timezone
            const slotDateInUserTZ = moment_timezone_1.default.tz(`${slot.start}`, userTimezone);
            const nowInUserTZ = moment_timezone_1.default.tz(nowPlusBuffer, userTimezone);
            // Compare in the user's timezone for correct results
            const isFuture = slotDateInUserTZ.isAfter(nowInUserTZ);
            console.log(`[FILTER:PAST:LOCAL] Slot time in ${userTimezone}: ${slotDateInUserTZ.format("YYYY-MM-DD HH:mm:ss")}`);
            console.log(`[FILTER:PAST:LOCAL] Current time+buffer in ${userTimezone}: ${nowInUserTZ.format("YYYY-MM-DD HH:mm:ss")}`);
            console.log(`[FILTER:PAST:LOCAL] Is future? ${isFuture}`);
            if (!isFuture) {
                console.log(`[FILTER:PAST] Filtered past local time slot: ${slot.start} in ${userTimezone}`);
            }
            return isFuture;
        }
        // For time ranges or all-day slots
        if (slot.isTimeRange || slot.isAllDay) {
            const slotDate = new Date(slot.start);
            // Check if it's today
            const nowDate = new Date(now);
            const isToday = slotDate.getFullYear() === nowDate.getFullYear() &&
                slotDate.getMonth() === nowDate.getMonth() &&
                slotDate.getDate() === nowDate.getDate();
            // For today's slots, check if the time has passed
            if (isToday) {
                const slotHours = slotDate.getHours();
                const slotMinutes = slotDate.getMinutes();
                const effectiveSlotTime = new Date(now);
                effectiveSlotTime.setHours(slotHours, slotMinutes, 0, 0);
                const effectiveNow = new Date(now.getTime() + bufferTime);
                const isFutureTime = effectiveSlotTime > effectiveNow;
                if (!isFutureTime) {
                    console.log(`[FILTER:PAST] Filtered today's past time range at ${slotHours}:${slotMinutes}`);
                }
                return isFutureTime;
            }
            // For future days, check if the day is in the past
            const compareDate = new Date(now);
            compareDate.setHours(0, 0, 0, 0); // Reset to beginning of day
            const slotDayStart = new Date(slotDate);
            slotDayStart.setHours(0, 0, 0, 0);
            const isFutureDay = slotDayStart >= compareDate;
            if (!isFutureDay) {
                console.log(`[FILTER:PAST] Filtered past day slot: ${slot.start}`);
            }
            return isFutureDay;
        }
        // For specific times
        const slotStartTime = new Date(slot.start);
        const isFuture = slotStartTime > nowPlusBuffer;
        if (!isFuture) {
            console.log(`[FILTER:PAST] Filtered past slot: ${slot.start}`);
        }
        return isFuture;
    });
    console.log(`[FILTER:PAST] Filtered out ${slots.length - futureSlotsOnly.length} past slots, ${futureSlotsOnly.length} remain`);
    return futureSlotsOnly;
}
/**
 * Filter slots based on working days from user preferences
 * @param slots Array of slots to filter
 * @param workDays Array of working days (0-6, where 0 is Sunday)
 * @returns Array of slots that fall on working days
 */
function filterByWorkingDays(slots, workDays) {
    // Array for weekday names for better logging
    const weekdayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    console.log(`[FILTER:WORKDAYS] Filtering by working days: ${workDays.join(",")} (${workDays.map((d) => weekdayNames[d]).join(", ")})`);
    // Create a copy of the input array to avoid modifying it
    const filteredSlots = slots.filter((slot) => {
        try {
            // Skip slots without start time
            if (!slot.start) {
                console.warn("[FILTER:WORKDAYS] Slot without start time, skipping filter check:", slot);
                return true; // Keep slots without start time and handle them later
            }
            // Parse the date using native Date or moment if available
            const dateObj = new Date(slot.start);
            // Skip invalid dates
            if (isNaN(dateObj.getTime())) {
                console.warn("[FILTER:WORKDAYS] Invalid date format in slot, skipping filter check:", slot.start);
                return true; // Keep for now, it will be filtered elsewhere
            }
            // Get day of week (0-6, where 0 is Sunday)
            const slotDay = dateObj.getDay();
            const weekdayName = weekdayNames[slotDay];
            // Check if this is a configured working day
            const isWorkDay = workDays.includes(slotDay);
            // Enhanced debugging for day-of-week determination
            console.log(`[FILTER:WORKDAYS:DEBUG] Checking slot on ${weekdayName} (${slotDay}): ${slot.start} - isWorkDay: ${isWorkDay}`);
            // Filter out non-working days
            if (!isWorkDay) {
                console.log(`[FILTER:WORKDAYS] Filtered slot on non-working day ${weekdayName} (${slotDay}): ${slot.start}`);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error(`[FILTER:WORKDAYS] Error processing slot: ${error}`, slot);
            return true; // Keep it for safety, let other filters decide
        }
    });
    console.log(`[FILTER:WORKDAYS] Filtered out ${slots.length - filteredSlots.length} slots, ${filteredSlots.length} remain`);
    return filteredSlots;
}
/**
 * Filter slots based on working hours from user preferences
 * @param slots Array of slots to filter
 * @param workingHoursStart Start of working hours (HH:MM:SS)
 * @param workingHoursEnd End of working hours (HH:MM:SS)
 * @param userTimezone User's timezone to properly apply working hours in local time
 * @returns Array of slots that fall within working hours
 */
function filterByWorkingHours(slots, workingHoursStart, workingHoursEnd, userTimezone) {
    console.log(`[FILTER:HOURS] Filtering by working hours: ${workingHoursStart} - ${workingHoursEnd} in timezone: ${userTimezone || "UTC"}`);
    // Parse working hours
    const workStartHour = parseInt(workingHoursStart.split(":")[0]);
    const workStartMinute = parseInt(workingHoursStart.split(":")[1]);
    const workEndHour = parseInt(workingHoursEnd.split(":")[0]);
    const workEndMinute = parseInt(workingHoursEnd.split(":")[1]);
    // Convert to minute values for easy comparison
    const workStartValue = workStartHour * 60 + workStartMinute;
    const workEndValue = workEndHour * 60 + workEndMinute;
    const filteredSlots = slots.filter((slot) => {
        try {
            // Special handling for time ranges and all-day slots
            if (slot.isAllDay) {
                // All-day slots will be expanded within working hours in a later step
                return true;
            }
            // FIXED: Improved working hours filter for time ranges
            // We should check if any part of the time range falls within working hours
            if (slot.isTimeRange) {
                // Get start and end time in user's timezone
                let startTime, endTime;
                if (userTimezone) {
                    startTime = moment_timezone_1.default.tz(slot.start, userTimezone);
                    endTime = moment_timezone_1.default.tz(slot.end, userTimezone);
                }
                else {
                    startTime = (0, moment_timezone_1.default)(slot.start);
                    endTime = (0, moment_timezone_1.default)(slot.end);
                }
                // Check if the time range overlaps with working hours
                const startHour = startTime.hour();
                const startMinute = startTime.minute();
                const startValue = startHour * 60 + startMinute;
                const endHour = endTime.hour();
                const endMinute = endTime.minute();
                const endValue = endHour * 60 + endMinute;
                // Time range overlaps with working hours if:
                // 1. Start time is within working hours, OR
                // 2. End time is within working hours, OR
                // 3. Range completely contains working hours
                const startInWorkingHours = startValue >= workStartValue && startValue < workEndValue;
                const endInWorkingHours = endValue > workStartValue && endValue <= workEndValue;
                const rangeContainsWorkingHours = startValue <= workStartValue && endValue >= workEndValue;
                const overlapsWorkingHours = startInWorkingHours || endInWorkingHours || rangeContainsWorkingHours;
                if (!overlapsWorkingHours) {
                    console.log(`[FILTER:HOURS] Time range ${startTime.format("HH:mm")}-${endTime.format("HH:mm")} doesn't overlap with working hours ${workingHoursStart}-${workingHoursEnd}`);
                }
                else {
                    console.log(`[FILTER:HOURS] Time range ${startTime.format("HH:mm")}-${endTime.format("HH:mm")} overlaps with working hours ${workingHoursStart}-${workingHoursEnd}`);
                }
                return overlapsWorkingHours;
            }
            let slotHour, slotMinute;
            // Use moment-timezone if timezone is provided to convert UTC to user local time
            if (userTimezone) {
                // Convert UTC slot time to user's local timezone for comparison with working hours
                const localSlotTime = moment_timezone_1.default.tz(slot.start, userTimezone);
                slotHour = localSlotTime.hour();
                slotMinute = localSlotTime.minute();
                // Debug timezone conversion
                console.log(`[FILTER:HOURS:DEBUG] Slot UTC time: ${slot.start}, Local time in ${userTimezone}: ${localSlotTime.format("YYYY-MM-DD HH:mm")}`);
            }
            else {
                // Fallback to UTC if no timezone provided
                const dateObj = new Date(slot.start);
                slotHour = dateObj.getHours();
                slotMinute = dateObj.getMinutes();
            }
            const slotValue = slotHour * 60 + slotMinute;
            const isWithinWorkingHours = slotValue >= workStartValue && slotValue < workEndValue;
            if (!isWithinWorkingHours) {
                if (userTimezone) {
                    const localTime = moment_timezone_1.default.tz(slot.start, userTimezone).format("HH:mm");
                    console.log(`[FILTER:HOURS] Filtered slot at local time ${localTime} outside working hours ${workingHoursStart}-${workingHoursEnd}`);
                }
                else {
                    console.log(`[FILTER:HOURS] Filtered slot outside working hours: ${slot.start}`);
                }
                return false;
            }
            return true;
        }
        catch (error) {
            console.error(`[FILTER:HOURS] Error parsing time: ${slot.start}`, error);
            return false;
        }
    });
    console.log(`[FILTER:HOURS] Filtered out ${slots.length - filteredSlots.length} slots, ${filteredSlots.length} remain`);
    return filteredSlots;
}
/**
 * Filter slots based on AM/PM preference
 * @param slots Array of slots to filter
 * @param timePreference "am", "pm", or "both"
 * @param userTimezone User's timezone to correctly determine AM/PM
 * @returns Array of slots that match the time preference
 */
function filterByTimePreference(slots, timePreference, userTimezone) {
    // If no preference ("both"), return all slots
    if (timePreference === "both") {
        console.log(`[FILTER:AM/PM] No time preference filtering needed (preference: ${timePreference})`);
        return slots;
    }
    console.log(`[FILTER:AM/PM] Filtering by time preference: ${timePreference} in timezone: ${userTimezone || "UTC"}`);
    console.log(`[FILTER:AM/PM:DEBUG] Starting with ${slots.length} slots`);
    // Log summary of input slots
    console.log(`[FILTER:AM/PM:DEBUG] Input slots summary:`);
    slots.forEach((slot, index) => {
        if (index < 5 || index > slots.length - 5) {
            // Just log first and last few to avoid too much output
            const startTime = userTimezone
                ? moment_timezone_1.default.tz(slot.start, userTimezone).format("YYYY-MM-DD HH:mm")
                : new Date(slot.start).toISOString();
            const endTime = slot.end && userTimezone
                ? moment_timezone_1.default.tz(slot.end, userTimezone).format("YYYY-MM-DD HH:mm")
                : slot.end
                    ? new Date(slot.end).toISOString()
                    : "undefined";
            console.log(`[FILTER:AM/PM:DEBUG] Slot ${index}: ${startTime} - ${endTime}, isTimeRange: ${!!slot.isTimeRange}, isAllDay: ${!!slot.isAllDay}`);
        }
        if (index === 5 && slots.length > 10) {
            console.log(`[FILTER:AM/PM:DEBUG] ... ${slots.length - 10} more slots ...`);
        }
    });
    const filteredSlots = slots.filter((slot) => {
        try {
            // Use moment-timezone if timezone is provided, otherwise fallback to Date
            let slotHour;
            let startLocalTime;
            let endLocalTime;
            if (userTimezone) {
                // Convert UTC time to user's timezone
                slotHour = moment_timezone_1.default.tz(slot.start, userTimezone).hour();
                startLocalTime = moment_timezone_1.default
                    .tz(slot.start, userTimezone)
                    .format("YYYY-MM-DD HH:mm");
                if (slot.end) {
                    endLocalTime = moment_timezone_1.default
                        .tz(slot.end, userTimezone)
                        .format("YYYY-MM-DD HH:mm");
                }
            }
            else {
                // Fallback to standard Date in UTC
                slotHour = new Date(slot.start).getHours();
                startLocalTime = new Date(slot.start).toISOString();
                if (slot.end) {
                    endLocalTime = new Date(slot.end).toISOString();
                }
            }
            console.log(`[FILTER:AM/PM:DEBUG] Processing slot: ${startLocalTime}${slot.end ? ` - ${endLocalTime}` : ""}, slotHour: ${slotHour}, isPM: ${slotHour >= 12}`);
            console.log(`[FILTER:AM/PM:DEBUG] Slot flags: isTimeRange=${!!slot.isTimeRange}, isAllDay=${!!slot.isAllDay}, isSpecificTime=${!!slot.isSpecificTime}`);
            // FIXED: Improved handling for time ranges, all-day, and slots with adaptedDuration
            if ((slot.isAllDay ||
                slot.isTimeRange ||
                slot.fromTimeRange ||
                slot.adaptedDuration) &&
                timePreference !== "both") {
                console.log(`[FILTER:AM/PM:DEBUG] Processing as time range, all-day or adapted duration slot`);
                if (timePreference === "pm") {
                    // Check if range includes PM times
                    let endHour;
                    if (userTimezone && slot.end) {
                        endHour = moment_timezone_1.default.tz(slot.end, userTimezone).hour();
                    }
                    else if (slot.end) {
                        endHour = new Date(slot.end).getHours();
                    }
                    else {
                        endHour = 18; // Default end time
                    }
                    // Check if time range spans noon or is entirely in PM
                    const startIsPM = slotHour >= 12;
                    const endIsPM = endHour >= 12;
                    const spansPM = startIsPM || endIsPM;
                    console.log(`[FILTER:AM/PM:DEBUG] Time range with startHour: ${slotHour}, endHour: ${endHour}, startIsPM: ${startIsPM}, endIsPM: ${endIsPM}, spansPM: ${spansPM}`);
                    if (!spansPM) {
                        console.log(`[FILTER:AM/PM] Filtered range slot without PM times: ${startLocalTime} (startHour: ${slotHour}, endHour: ${endHour})`);
                        return false;
                    }
                    console.log(`[FILTER:AM/PM:DEBUG] Keeping range slot that includes PM time: ${startLocalTime}`);
                    return true;
                }
                else if (timePreference === "am") {
                    // Check if range includes AM times
                    let startHour;
                    if (userTimezone) {
                        startHour = moment_timezone_1.default.tz(slot.start, userTimezone).hour();
                    }
                    else {
                        startHour = new Date(slot.start).getHours();
                    }
                    // Check if time range spans midnight or is entirely in AM
                    let endHour;
                    if (userTimezone && slot.end) {
                        endHour = moment_timezone_1.default.tz(slot.end, userTimezone).hour();
                    }
                    else if (slot.end) {
                        endHour = new Date(slot.end).getHours();
                    }
                    else {
                        endHour = 9; // Default end time for AM
                    }
                    const startIsAM = startHour < 12;
                    const endIsAM = endHour < 12;
                    const spansAM = startIsAM || endIsAM;
                    console.log(`[FILTER:AM/PM:DEBUG] Time range with startHour: ${startHour}, endHour: ${endHour}, startIsAM: ${startIsAM}, endIsAM: ${endIsAM}, spansAM: ${spansAM}`);
                    if (!spansAM) {
                        console.log(`[FILTER:AM/PM] Filtered range slot without AM times: ${startLocalTime} (startHour: ${startHour}, endHour: ${endHour})`);
                        return false;
                    }
                    console.log(`[FILTER:AM/PM:DEBUG] Keeping range slot that includes AM time: ${startLocalTime}`);
                    return true;
                }
            }
            // For specific time slots
            else if (timePreference !== "both") {
                const isPM = slotHour >= 12;
                const matchesPreference = (timePreference === "pm" && isPM) ||
                    (timePreference === "am" && !isPM);
                console.log(`[FILTER:AM/PM:DEBUG] Specific time slot check: slotHour=${slotHour}, isPM=${isPM}, timePreference=${timePreference}, matches=${matchesPreference}`);
                if (!matchesPreference) {
                    if (userTimezone) {
                        const localTime = moment_timezone_1.default
                            .tz(slot.start, userTimezone)
                            .format("HH:mm");
                        console.log(`[FILTER:AM/PM] Filtered slot at local time ${localTime} not matching ${timePreference} preference`);
                    }
                    else {
                        console.log(`[FILTER:AM/PM] Filtered slot not matching ${timePreference} preference: ${slot.start}`);
                    }
                    return false;
                }
                console.log(`[FILTER:AM/PM:DEBUG] Keeping specific time slot that matches preference: ${startLocalTime}`);
            }
            return true;
        }
        catch (error) {
            console.error(`[FILTER:AM/PM] Error parsing time: ${slot.start}`, error);
            return false;
        }
    });
    console.log(`[FILTER:AM/PM] Summary: ${slots.length} input → ${filteredSlots.length} output, filtered out ${slots.length - filteredSlots.length} slots`);
    return filteredSlots;
}
/**
 * Filter slots based on buffer time alignment
 * Ensures that each slot has the required buffer time before and after,
 * aligning with the user's buffer preference
 *
 * @param slots Array of slots to filter
 * @param bufferMinutes Number of minutes required as buffer
 * @param userTimezone User's timezone for proper time calculations
 * @returns Array of slots that have proper buffer time alignment
 */
function filterByBufferAlignment(slots, bufferMinutes, userTimezone) {
    if (bufferMinutes <= 0) {
        // No buffer required, return all slots
        return slots;
    }
    console.log(`[FILTER:BUFFER] Applying buffer alignment filter with ${bufferMinutes} minutes buffer in timezone ${userTimezone || "not provided"}`);
    // Group slots by date to check adjacent slots
    const slotsByDate = {};
    // First, group and parse all slots by date
    slots.forEach((slot) => {
        try {
            // Skip all-day or time range slots - they'll be handled by other filters
            if (slot.isTimeRange || slot.isAllDay) {
                return;
            }
            // Parse start and end times with timezone
            const startMoment = userTimezone
                ? moment_timezone_1.default.tz(slot.start, userTimezone)
                : (0, moment_timezone_1.default)(slot.start);
            const endMoment = userTimezone
                ? moment_timezone_1.default.tz(slot.end, userTimezone)
                : (0, moment_timezone_1.default)(slot.end);
            // Group by date (YYYY-MM-DD format)
            const dateKey = startMoment.format("YYYY-MM-DD");
            if (!slotsByDate[dateKey]) {
                slotsByDate[dateKey] = [];
            }
            slotsByDate[dateKey].push({
                slot,
                start: startMoment,
                end: endMoment,
            });
        }
        catch (error) {
            console.error("[FILTER:BUFFER] Error parsing slot time:", error);
        }
    });
    // Sort slots by start time for each date
    Object.keys(slotsByDate).forEach((date) => {
        slotsByDate[date].sort((a, b) => a.start.valueOf() - b.start.valueOf());
    });
    // Filter slots that have proper buffer
    const filteredSlots = [];
    Object.keys(slotsByDate).forEach((date) => {
        const dateSlots = slotsByDate[date];
        // Check each slot against adjacent slots
        dateSlots.forEach((current, index) => {
            let hasBufferBefore = true;
            let hasBufferAfter = true;
            // Check buffer with previous slot
            if (index > 0) {
                const prev = dateSlots[index - 1];
                const requiredGap = bufferMinutes * 60 * 1000; // Convert to milliseconds
                // Check if there's enough buffer between this slot's start and previous slot's end
                if (current.start.valueOf() - prev.end.valueOf() < requiredGap) {
                    hasBufferBefore = false;
                }
            }
            // Check buffer with next slot
            if (index < dateSlots.length - 1) {
                const next = dateSlots[index + 1];
                const requiredGap = bufferMinutes * 60 * 1000; // Convert to milliseconds
                // Check if there's enough buffer between this slot's end and next slot's start
                if (next.start.valueOf() - current.end.valueOf() < requiredGap) {
                    hasBufferAfter = false;
                }
            }
            // Include the slot only if it has proper buffer before and after
            if (hasBufferBefore && hasBufferAfter) {
                filteredSlots.push(current.slot);
            }
            else {
                console.log(`[FILTER:BUFFER] Filtered out slot at ${current.start.format("HH:mm")} due to insufficient buffer ${hasBufferBefore ? "" : "before"} ${hasBufferAfter ? "" : "after"}`);
            }
        });
    });
    console.log(`[FILTER:BUFFER] Filtered out ${slots.length - filteredSlots.length} slots without proper buffer, ${filteredSlots.length} remain`);
    return filteredSlots;
}
/**
 * Filter slots based on calendar availability
 * @param slots Array of slots to filter
 * @param user User for Google Calendar access
 * @param bufferMinutes Buffer time in minutes
 * @param userTimezone User's timezone
 * @returns Promise resolving to array of available slots
 */
async function filterByCalendarAvailability(slots, user, bufferMinutes, userTimezone, meetingDuration, slotInterval, workingHoursStart, workingHoursEnd, debugMode = true // Always enable debug mode to help with diagnostics
) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    console.log(`[FILTER:CALENDAR] Checking calendar availability for ${slots.length} slots`);
    const auth = (0, google_calendar_utils_1.createGoogleClient)(user);
    const calendar = googleapis_1.google.calendar("v3");
    const availableSlots = [];
    for (const slot of slots) {
        try {
            // Handle time ranges and all-day slots
            // FIXED: Check for fromTimeRange as well to properly handle individual slots generated from time ranges
            if (slot.isTimeRange || slot.isAllDay || slot.fromTimeRange) {
                const dateStr = ((_a = slot.start) === null || _a === void 0 ? void 0 : _a.split("T")[0]) ||
                    ((_b = slot.end) === null || _b === void 0 ? void 0 : _b.split("T")[0]) ||
                    (0, moment_timezone_1.default)().format("YYYY-MM-DD");
                // Get effective time range
                let startTimeStr, endTimeStr;
                if (slot.isAllDay) {
                    // Use working hours for all-day slots
                    startTimeStr = `${dateStr}T${workingHoursStart}`;
                    endTimeStr = `${dateStr}T${workingHoursEnd}`;
                    const rangeStart = moment_timezone_1.default.tz(`${startTimeStr}`, userTimezone);
                    const rangeEnd = moment_timezone_1.default.tz(`${endTimeStr}`, userTimezone);
                    // Generate and check potential slots
                    let currentStart = rangeStart.clone();
                    const generatedSlots = [];
                    // Generate slots until we can't fit another in the range
                    while (currentStart
                        .clone()
                        .add(meetingDuration, "minutes")
                        .isSameOrBefore(rangeEnd)) {
                        const slotEnd = currentStart
                            .clone()
                            .add(meetingDuration, "minutes");
                        // Check calendar conflicts
                        const queryStart = currentStart
                            .clone()
                            .subtract(bufferMinutes, "minutes");
                        const queryEnd = slotEnd.clone().add(bufferMinutes, "minutes");
                        try {
                            const freeBusyResponse = await calendar.freebusy.query({
                                auth,
                                requestBody: {
                                    timeMin: queryStart.toISOString(),
                                    timeMax: queryEnd.toISOString(),
                                    timeZone: userTimezone,
                                    items: [{ id: "primary" }],
                                },
                            });
                            const busyPeriods = ((_d = (_c = freeBusyResponse.data.calendars) === null || _c === void 0 ? void 0 : _c.primary) === null || _d === void 0 ? void 0 : _d.busy) || [];
                            if (busyPeriods.length === 0) {
                                generatedSlots.push({
                                    start: currentStart.utc().toISOString(),
                                    end: slotEnd.utc().toISOString(),
                                    fromAllDay: true,
                                });
                            }
                            else {
                                // Check if any of the busy periods actually conflict with the core meeting time
                                // (not just the buffer times)
                                let hasActualConflict = false;
                                // Log conflict details for debugging
                                const slotRangeLocal = `${currentStart.format("YYYY-MM-DD HH:mm")} - ${slotEnd.format("YYYY-MM-DD HH:mm")}`;
                                for (const busy of busyPeriods) {
                                    const busyStart = (0, moment_timezone_1.default)(busy.start);
                                    const busyEnd = (0, moment_timezone_1.default)(busy.end);
                                    const busyRangeLocal = `${busyStart
                                        .tz(userTimezone)
                                        .format("YYYY-MM-DD HH:mm")} - ${busyEnd
                                        .tz(userTimezone)
                                        .format("YYYY-MM-DD HH:mm")}`;
                                    console.log(`[FILTER:CALENDAR:ALL-DAY:CONFLICT] Conflict detected in timezone ${userTimezone}: {
                    slotRange: '${slotRangeLocal}',
                    busyRange: '${busyRangeLocal}'
                  }`);
                                    // Check if this is an actual conflict with the meeting time (not just buffer)
                                    const isRealConflict = !(busyEnd.isSameOrBefore(currentStart) ||
                                        busyStart.isSameOrAfter(slotEnd));
                                    if (isRealConflict) {
                                        console.log(`[FILTER:CALENDAR:ALL-DAY:CONFLICT] This is a real conflict with the actual meeting time`);
                                        hasActualConflict = true;
                                    }
                                    else {
                                        // This is only a buffer conflict, not a real meeting conflict
                                        console.log(`[FILTER:CALENDAR:ALL-DAY:CONFLICT] This is only a buffer overlap, not a real meeting conflict!`);
                                        // Determine if it's a start buffer or end buffer overlap
                                        if (busyEnd.isSameOrBefore(currentStart)) {
                                            console.log(`[FILTER:CALENDAR:ALL-DAY:CONFLICT] Conflict only with start buffer time`);
                                        }
                                        else {
                                            console.log(`[FILTER:CALENDAR:ALL-DAY:CONFLICT] Conflict only with end buffer time`);
                                        }
                                    }
                                }
                                if (hasActualConflict) {
                                    console.log(`[FILTER:CALENDAR:ALL-DAY:REJECT] Rejected all-day slot with real calendar conflicts`);
                                }
                                else {
                                    // Add the slot if there are only buffer conflicts
                                    console.log(`[FILTER:CALENDAR:ALL-DAY:ACCEPT] Accepted all-day slot despite buffer conflicts`);
                                    generatedSlots.push({
                                        start: currentStart.utc().toISOString(),
                                        end: slotEnd.utc().toISOString(),
                                        fromAllDay: true,
                                    });
                                }
                            }
                        }
                        catch (error) {
                            console.error("[FILTER:CALENDAR] Error checking calendar for all-day slot:", error);
                        }
                        currentStart.add(slotInterval, "minutes");
                    }
                    console.log(`[FILTER:CALENDAR] Generated ${generatedSlots.length} available slots for all-day slot`);
                    availableSlots.push(...generatedSlots);
                    continue;
                }
                else {
                    // For time ranges, process similarly but with more logic for different scenarios
                    const workStartStr = `${dateStr}T${workingHoursStart}`;
                    const workEndStr = `${dateStr}T${workingHoursEnd}`;
                    // Determine effective start and end times
                    if (slot.start && slot.end && !slot.needsEndTimeCalculation) {
                        startTimeStr = slot.start;
                        endTimeStr = slot.end;
                    }
                    else if (slot.start && slot.needsEndTimeCalculation) {
                        startTimeStr = slot.start;
                        endTimeStr = workEndStr;
                    }
                    else if (slot.needsStartTimeCalculation && slot.end) {
                        startTimeStr = workStartStr;
                        endTimeStr = slot.end;
                    }
                    else {
                        startTimeStr = workStartStr;
                        endTimeStr = workEndStr;
                    }
                    // Parse times
                    const startTimeHours = parseInt(startTimeStr.split("T")[1].split(":")[0]);
                    const startTimeMinutes = parseInt(startTimeStr.split("T")[1].split(":")[1]);
                    const endTimeHours = parseInt(endTimeStr.split("T")[1].split(":")[0]);
                    const endTimeMinutes = parseInt(endTimeStr.split("T")[1].split(":")[1]);
                    const workStartHours = parseInt(workStartStr.split("T")[1].split(":")[0]);
                    const workStartMinutes = parseInt(workStartStr.split("T")[1].split(":")[1]);
                    const workEndHours = parseInt(workEndStr.split("T")[1].split(":")[0]);
                    const workEndMinutes = parseInt(workEndStr.split("T")[1].split(":")[1]);
                    // Ensure times are within working hours
                    let adjustedStartHours = startTimeHours;
                    let adjustedStartMinutes = startTimeMinutes;
                    let adjustedEndHours = endTimeHours;
                    let adjustedEndMinutes = endTimeMinutes;
                    // Convert to minute values
                    const startTimeValue = startTimeHours * 60 + startTimeMinutes;
                    const endTimeValue = endTimeHours * 60 + endTimeMinutes;
                    const workStartValue = workStartHours * 60 + workStartMinutes;
                    const workEndValue = workEndHours * 60 + workEndMinutes;
                    // Adjust start time if before working hours
                    if (startTimeValue < workStartValue) {
                        adjustedStartHours = workStartHours;
                        adjustedStartMinutes = workStartMinutes;
                    }
                    // Adjust end time if after working hours
                    if (endTimeValue > workEndValue) {
                        adjustedEndHours = workEndHours;
                        adjustedEndMinutes = workEndMinutes;
                    }
                    // Create adjusted time strings
                    const adjustedStartTimeStr = `${dateStr}T${String(adjustedStartHours).padStart(2, "0")}:${String(adjustedStartMinutes).padStart(2, "0")}:00`;
                    const adjustedEndTimeStr = `${dateStr}T${String(adjustedEndHours).padStart(2, "0")}:${String(adjustedEndMinutes).padStart(2, "0")}:00`;
                    // Skip invalid ranges
                    const adjustedStartValue = adjustedStartHours * 60 + adjustedStartMinutes;
                    const adjustedEndValue = adjustedEndHours * 60 + adjustedEndMinutes;
                    if (adjustedStartValue >= adjustedEndValue) {
                        console.log("[FILTER:CALENDAR] Skipping invalid time range (start >= end)");
                        continue;
                    }
                    // Generate slots
                    const rangeStart = moment_timezone_1.default.tz(`${adjustedStartTimeStr}`, userTimezone);
                    const rangeEnd = moment_timezone_1.default.tz(`${adjustedEndTimeStr}`, userTimezone);
                    let currentStart = rangeStart.clone();
                    const generatedSlots = [];
                    while (currentStart
                        .clone()
                        .add(meetingDuration, "minutes")
                        .isSameOrBefore(rangeEnd)) {
                        const slotEnd = currentStart
                            .clone()
                            .add(meetingDuration, "minutes");
                        // Check calendar conflicts
                        const queryStart = currentStart
                            .clone()
                            .subtract(bufferMinutes, "minutes");
                        const queryEnd = slotEnd.clone().add(bufferMinutes, "minutes");
                        try {
                            const freeBusyResponse = await calendar.freebusy.query({
                                auth,
                                requestBody: {
                                    timeMin: queryStart.toISOString(),
                                    timeMax: queryEnd.toISOString(),
                                    timeZone: userTimezone,
                                    items: [{ id: "primary" }],
                                },
                            });
                            const busyPeriods = ((_f = (_e = freeBusyResponse.data.calendars) === null || _e === void 0 ? void 0 : _e.primary) === null || _f === void 0 ? void 0 : _f.busy) || [];
                            if (busyPeriods.length === 0) {
                                generatedSlots.push({
                                    start: currentStart.utc().toISOString(),
                                    end: slotEnd.utc().toISOString(),
                                    fromTimeRange: true, // Maintain that this came from a time range
                                });
                            }
                            else {
                                // Check if any of the busy periods actually conflict with the core meeting time
                                // (not just the buffer times)
                                let hasActualConflict = false;
                                // Log conflict details for debugging
                                const slotRangeLocal = `${currentStart.format("YYYY-MM-DD HH:mm")} - ${slotEnd.format("YYYY-MM-DD HH:mm")}`;
                                for (const busy of busyPeriods) {
                                    const busyStart = (0, moment_timezone_1.default)(busy.start);
                                    const busyEnd = (0, moment_timezone_1.default)(busy.end);
                                    const busyRangeLocal = `${busyStart
                                        .tz(userTimezone)
                                        .format("YYYY-MM-DD HH:mm")} - ${busyEnd
                                        .tz(userTimezone)
                                        .format("YYYY-MM-DD HH:mm")}`;
                                    console.log(`[FILTER:CALENDAR:TIME-RANGE:CONFLICT] Conflict detected in timezone ${userTimezone}: {
                    slotRange: '${slotRangeLocal}',
                    busyRange: '${busyRangeLocal}'
                  }`);
                                    // Check if this is an actual conflict with the meeting time (not just buffer)
                                    const isRealConflict = !(busyEnd.isSameOrBefore(currentStart) ||
                                        busyStart.isSameOrAfter(slotEnd));
                                    if (isRealConflict) {
                                        console.log(`[FILTER:CALENDAR:TIME-RANGE:CONFLICT] This is a real conflict with the actual meeting time`);
                                        hasActualConflict = true;
                                    }
                                    else {
                                        // This is only a buffer conflict, not a real meeting conflict
                                        console.log(`[FILTER:CALENDAR:TIME-RANGE:CONFLICT] This is only a buffer overlap, not a real meeting conflict!`);
                                        // Determine if it's a start buffer or end buffer overlap
                                        if (busyEnd.isSameOrBefore(currentStart)) {
                                            console.log(`[FILTER:CALENDAR:TIME-RANGE:CONFLICT] Conflict only with start buffer time`);
                                        }
                                        else {
                                            console.log(`[FILTER:CALENDAR:TIME-RANGE:CONFLICT] Conflict only with end buffer time`);
                                        }
                                    }
                                }
                                if (hasActualConflict) {
                                    console.log(`[FILTER:CALENDAR:TIME-RANGE:REJECT] Rejected time range slot with real calendar conflicts`);
                                }
                                else {
                                    // Add the slot if there are only buffer conflicts
                                    console.log(`[FILTER:CALENDAR:TIME-RANGE:ACCEPT] Accepted time range slot despite buffer conflicts`);
                                    generatedSlots.push({
                                        start: currentStart.utc().toISOString(),
                                        end: slotEnd.utc().toISOString(),
                                        fromTimeRange: true, // Maintain that this came from a time range
                                    });
                                }
                            }
                        }
                        catch (error) {
                            console.error("[FILTER:CALENDAR] Error checking calendar for time range slot:", error);
                        }
                        currentStart.add(slotInterval, "minutes");
                    }
                    console.log(`[FILTER:CALENDAR] Generated ${generatedSlots.length} available slots for time range`);
                    availableSlots.push(...generatedSlots);
                }
            }
            else {
                // For specific time slots
                const slotStart = (0, moment_timezone_1.default)(slot.start);
                const slotEnd = (0, moment_timezone_1.default)(slot.end);
                // Check calendar conflicts
                const queryStart = slotStart.clone().subtract(bufferMinutes, "minutes");
                const queryEnd = slotEnd.clone().add(bufferMinutes, "minutes");
                try {
                    // Enhanced logging for calendar queries (specific time slots)
                    console.log(`[FILTER:CALENDAR:SPECIFIC] Checking specific time slot: ${slotStart.format("YYYY-MM-DD HH:mm")} - ${slotEnd.format("YYYY-MM-DD HH:mm")}`);
                    console.log(`[FILTER:CALENDAR:SPECIFIC] Including buffer: ${queryStart.format("YYYY-MM-DD HH:mm")} - ${queryEnd.format("YYYY-MM-DD HH:mm")}`);
                    console.log(`[FILTER:CALENDAR:SPECIFIC] User timezone: ${userTimezone}`);
                    if (slot.fromTimeRange) {
                        console.log(`[FILTER:CALENDAR:SPECIFIC] This slot was generated from a time range`);
                    }
                    const freeBusyResponse = await calendar.freebusy.query({
                        auth,
                        requestBody: {
                            timeMin: queryStart.toISOString(),
                            timeMax: queryEnd.toISOString(),
                            timeZone: userTimezone,
                            items: [{ id: "primary" }],
                        },
                    });
                    // Log the full API response for debugging
                    console.log(`[FILTER:CALENDAR:SPECIFIC] API response: ${JSON.stringify(freeBusyResponse.data)}`);
                    const busyPeriods = ((_h = (_g = freeBusyResponse.data.calendars) === null || _g === void 0 ? void 0 : _g.primary) === null || _h === void 0 ? void 0 : _h.busy) || [];
                    console.log(`[FILTER:CALENDAR:SPECIFIC] Found ${busyPeriods.length} busy periods`);
                    if (busyPeriods.length === 0) {
                        console.log(`[FILTER:CALENDAR:SPECIFIC:SUCCESS] Slot is available and will be added: ${slotStart.format("YYYY-MM-DD HH:mm")} - ${slotEnd.format("YYYY-MM-DD HH:mm")}`);
                        availableSlots.push(slot);
                    }
                    else {
                        // Check if any of the busy periods actually conflict with the core meeting time
                        // (not just the buffer times)
                        let hasActualConflict = false;
                        // Always log detailed conflict information regardless of debugMode
                        const slotStartLocal = slotStart
                            .tz(userTimezone)
                            .format("YYYY-MM-DD HH:mm");
                        const slotEndLocal = slotEnd
                            .tz(userTimezone)
                            .format("YYYY-MM-DD HH:mm");
                        const slotRangeLocal = `${slotStartLocal} - ${slotEndLocal}`;
                        for (const busy of busyPeriods) {
                            const busyStart = (0, moment_timezone_1.default)(busy.start);
                            const busyEnd = (0, moment_timezone_1.default)(busy.end);
                            const busyRangeLocal = `${busyStart
                                .tz(userTimezone)
                                .format("YYYY-MM-DD HH:mm")} - ${busyEnd
                                .tz(userTimezone)
                                .format("YYYY-MM-DD HH:mm")}`;
                            console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] Conflict detected in timezone ${userTimezone}:`);
                            console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] Slot: ${slotRangeLocal}`);
                            console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] Busy: ${busyRangeLocal}`);
                            console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] Raw busy data: ${JSON.stringify(busy)}`);
                            // Check if this is an actual conflict with the meeting time (not just buffer)
                            // A real conflict exists if the busy period overlaps with the actual meeting time
                            const isRealConflict = !(busyEnd.isSameOrBefore(slotStart) ||
                                busyStart.isSameOrAfter(slotEnd));
                            if (isRealConflict) {
                                console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] This is a real conflict with the actual meeting time`);
                                hasActualConflict = true;
                            }
                            else {
                                // This is only a buffer conflict, not a real meeting conflict
                                console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] This is only a buffer overlap, not a real meeting conflict!`);
                                // Determine if it's a start buffer or end buffer overlap
                                if (busyEnd.isSameOrBefore(slotStart)) {
                                    console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] Conflict only with start buffer time`);
                                }
                                else {
                                    console.log(`[FILTER:CALENDAR:SPECIFIC:CONFLICT] Conflict only with end buffer time`);
                                }
                            }
                        }
                        if (hasActualConflict) {
                            console.log(`[FILTER:CALENDAR:SPECIFIC:REJECT] Slot rejected due to real calendar conflicts: ${slotStart.format("YYYY-MM-DD HH:mm")} - ${slotEnd.format("YYYY-MM-DD HH:mm")}`);
                        }
                        else {
                            console.log(`[FILTER:CALENDAR:SPECIFIC:ACCEPT] Slot accepted despite buffer conflicts: ${slotStart.format("YYYY-MM-DD HH:mm")} - ${slotEnd.format("YYYY-MM-DD HH:mm")}`);
                            // Log so we know we're using the buffer conflict fix
                            console.log(`[FILTER:CALENDAR:BUFFER-FIX] Adding slot with buffer-only conflicts`);
                            availableSlots.push(slot);
                        }
                    }
                }
                catch (error) {
                    console.error("[FILTER:CALENDAR] Error checking calendar for specific slot:", error);
                }
            }
        }
        catch (error) {
            console.error("[FILTER:CALENDAR] Error processing slot:", error);
        }
    }
    console.log(`[FILTER:CALENDAR] After availability check: ${availableSlots.length} slots available`);
    return availableSlots;
}
/**
 * Get user preferences from the database or use defaults
 */
async function getUserPreferences(userId) {
    // Get user's calendar preferences
    const [prefs] = await db_1.db
        .select()
        .from(schema_1.preferences)
        .where((0, drizzle_orm_1.eq)(schema_1.preferences.userId, userId));
    // Get preferences from database or use defaults
    if (prefs) {
        return {
            preferences: prefs,
            timezone: "UTC",
        };
    }
    else {
        // Set default preferences if none are found
        console.log("No user preferences found, using defaults");
        return {
            preferences: {
                workingHoursStart: "09:00:00",
                workingHoursEnd: "17:00:00",
                meetingDuration: 30,
                bufferTime: 15,
                workDays: "1,2,3,4,5",
                timePreference: "both",
                slotInterval: 30,
            },
            timezone: "UTC",
        };
    }
}
/**
 * Generate multiple shorter slots from a single time range
 * @param slot The original time range slot
 * @param meetingDuration User's preferred meeting duration in minutes
 * @param slotInterval Interval between generated slots in minutes
 * @returns Array of shorter slots within the original range
 */
/**
 * Generate multiple shorter slots from a single long time range
 * @param slot The original time range slot
 * @param meetingDuration Duration of each generated slot in minutes
 * @param slotInterval Gap between starting times of consecutive slots in minutes
 * @returns Array of shorter slots
 */
/**
 * Generate shorter slots from a time range
 * This function splits long time ranges into multiple shorter slots with the specified meeting duration
 * @param slot Input slot with start and end times
 * @param meetingDuration Duration of each generated slot in minutes (e.g., 30, 60, 90)
 * @param slotInterval Interval between slot start times in minutes (e.g., 30, 60)
 * @param userTimezone User's timezone for local time calculation
 * @returns Array of shorter slots
 */
/**
 * Generates shorter slots from a time range
 * - When isTimeRange=true, the slot is broken down into smaller, specific time slots
 * - Meeting duration is determined from email analysis or user preferences
 * - Generated slots always have isTimeRange=false and isSpecificTime=true
 *
 * @param slot The original time range slot
 * @param meetingDuration Preferred meeting duration in minutes (from email or user preferences)
 * @param slotInterval Interval between slots in minutes
 * @param userTimezone User's timezone for local time conversion
 * @returns Array of generated shorter, specific time slots
 */
// The generateShorterSlotsFromRange function is now imported from ./timezone-conversion-service
/**
 * Process slots through the filtering pipeline
 * @param slots Initial slots to process
 * @param user Authenticated user
 * @param userPreferences User preferences
 * @param userTimezone User's timezone
 * @returns Promise resolving to filtered slots
 */
async function processSlotsThroughPipeline(slots, user, userPreferences, userTimezone, debug = false, // Add debug flag
extractedMeetingDuration = null // Add parameter for extracted meeting duration
) {
    console.log("Starting slot filtering pipeline...");
    // Extract preferences
    const workDays = userPreferences.workDays
        ? userPreferences.workDays
            .split(",")
            .map((day) => parseInt(day.trim()))
        : [1, 2, 3, 4, 5];
    const workingHoursStart = userPreferences.workingHoursStart || "09:00:00";
    const workingHoursEnd = userPreferences.workingHoursEnd || "17:00:00";
    // Use consistent "both" value for no preference
    const timePreference = userPreferences.timePreference || "both";
    const bufferMinutes = userPreferences.bufferTime || 15;
    // Use extracted meeting duration from email if available, otherwise use user preferences
    const meetingDuration = extractedMeetingDuration || userPreferences.meetingDuration || 30;
    console.log(`Meeting duration: ${meetingDuration} minutes ${extractedMeetingDuration ? "(from email)" : "(from user preferences)"}`);
    const slotInterval = userPreferences.slotInterval || 60;
    // Enhanced logging for pipeline debugging
    console.log(`[PIPELINE:PARAMS] Working days: ${workDays.join(", ")}`);
    console.log(`[PIPELINE:PARAMS] Working hours: ${workingHoursStart} - ${workingHoursEnd}`);
    console.log(`[PIPELINE:PARAMS] Time preference: ${timePreference}`);
    console.log(`[PIPELINE:PARAMS] Meeting duration: ${meetingDuration} minutes`);
    console.log(`[PIPELINE:PARAMS] Slot interval: ${slotInterval} minutes`);
    console.log(`[PIPELINE:PARAMS] Buffer time: ${bufferMinutes} minutes`);
    console.log(`[PIPELINE:PARAMS] User timezone: ${userTimezone}`);
    // Create a copy of the slots to not modify the original
    let processedSlots = [...slots];
    console.log(`[PIPELINE:START] Initial slots: ${processedSlots.length}`);
    processedSlots.forEach((slot, index) => {
        console.log(`[PIPELINE:SLOT:${index}] ${slot.start} - ${slot.end} (isTimeRange: ${slot.isTimeRange}, isAllDay: ${slot.isAllDay})`);
    });
    // *** REORDERED PIPELINE STEPS ***
    // New Step 1: First generate multiple shorter slots from longer time ranges
    // This ensures that time ranges are properly processed before we filter them
    console.log(`[PIPELINE:STEP1] Starting slot expansion: Processing ${processedSlots.length} initial slots`);
    let expandedSlots = [];
    for (const slot of processedSlots) {
        // Check if this is an open-ended time range that needs end time calculation
        if (slot.needsEndTimeCalculation === true) {
            console.log(`[PIPELINE:SLOT:EXPAND] Detected slot with open-ended time range: ${slot.start}`);
            // Use working hours end as the default end time for open-ended slots
            const datePart = slot.start.split("T")[0];
            const defaultEndTime = workingHoursEnd;
            slot.end = `${datePart}T${defaultEndTime}`;
            console.log(`[PIPELINE:SLOT:EXPAND] Applied working hours end time: ${slot.end}`);
            // Remove the flag since we've handled it
            delete slot.needsEndTimeCalculation;
        }
        // Check if the slot has both start and end times
        if (slot.start && slot.end) {
            // Calculate duration in minutes
            let start, end;
            // Special handling for local time slots (no sourceTimezone) to calculate duration correctly
            if (!slot.sourceTimezone && userTimezone) {
                const startDate = slot.start.split("T")[0];
                const startTime = slot.start.split("T")[1] || "00:00:00";
                const endDate = slot.end.split("T")[0];
                const endTime = slot.end.split("T")[1] || "23:59:59";
                start = moment_timezone_1.default.tz(`${startDate}T${startTime}`, userTimezone);
                end = moment_timezone_1.default.tz(`${endDate}T${endTime}`, userTimezone);
            }
            else {
                start = (0, moment_timezone_1.default)(slot.start);
                end = (0, moment_timezone_1.default)(slot.end);
            }
            const durationMinutes = end.diff(start, "minutes");
            // Log slot details for debugging
            console.log(`[PIPELINE:SLOT:EXPAND] Processing slot ${slot.start} - ${slot.end}`);
            console.log(`[PIPELINE:SLOT:EXPAND] Duration: ${durationMinutes} min, Meeting duration: ${meetingDuration} min`);
            console.log(`[PIPELINE:SLOT:EXPAND] Flags: isTimeRange=${slot.isTimeRange}, isAllDay=${slot.isAllDay}, fromTimeRange=${slot.fromTimeRange}, fromAllDay=${slot.fromAllDay}`);
            // FIXED: Adapt meeting duration for shorter time ranges
            // If the duration is at least 25 minutes but less than preferred meeting duration,
            // we'll adapt the meeting duration to fit the time range instead of rejecting it
            let adaptedMeetingDuration = meetingDuration;
            let isAdaptedDuration = false;
            if (durationMinutes < meetingDuration) {
                // Only adapt if the duration is at least 25 minutes
                if (durationMinutes >= 25) {
                    console.log(`[PIPELINE:ADAPT] Adapting meeting duration from ${meetingDuration} to ${durationMinutes} minutes to fit the shorter time range`);
                    adaptedMeetingDuration = durationMinutes;
                    isAdaptedDuration = true;
                }
            }
            // Process time ranges and all-day slots
            if (durationMinutes > adaptedMeetingDuration ||
                slot.isTimeRange ||
                slot.isAllDay ||
                slot.fromTimeRange ||
                slot.fromAllDay ||
                isAdaptedDuration) {
                console.log(`[PIPELINE:SLOT:EXPAND] Will split into shorter slots`);
                // Generate multiple shorter slots from this time range
                // FIXED: Pass the adaptedMeetingDuration instead of the original meetingDuration
                const shorterSlots = (0, timezone_conversion_service_1.generateShorterSlotsFromRange)(slot, adaptedMeetingDuration, // Using adaptedMeetingDuration which respects email duration
                slotInterval, userTimezone);
                console.log(`[PIPELINE:SLOT:EXPAND] Generated ${shorterSlots.length} shorter slots`);
                // Log first few generated slots for verification
                shorterSlots.slice(0, 3).forEach((shorter, idx) => {
                    console.log(`[PIPELINE:SLOT:EXPAND:GENERATED:${idx}] ${shorter.start} - ${shorter.end}`);
                });
                if (shorterSlots.length > 3) {
                    console.log(`[PIPELINE:SLOT:EXPAND:GENERATED] ... and ${shorterSlots.length - 3} more slots`);
                }
                expandedSlots.push(...shorterSlots);
            }
            else {
                // This is already a specific time slot with appropriate duration
                console.log(`[PIPELINE:SLOT:EXPAND] Keeping original slot (no expansion needed)`);
                expandedSlots.push(slot);
            }
        }
        else {
            // Keep slots without complete time information as is
            console.log(`[PIPELINE:SLOT:EXPAND] Slot has incomplete time info, keeping as is`);
            expandedSlots.push(slot);
        }
    }
    // Replace the processed slots with our expanded set
    processedSlots = expandedSlots;
    console.log(`[PIPELINE:STEP1] Slot expansion results: ${slots.length} original slots -> ${processedSlots.length} expanded slots`);
    // Step 2: Now filter past slots AFTER expanding them
    const slotsBeforePastFilter = processedSlots.length;
    processedSlots = filterPastSlots(processedSlots, userTimezone);
    console.log(`[PIPELINE:STEP2] Past filtering: ${slotsBeforePastFilter} -> ${processedSlots.length}`);
    // Step 3: Now filter by working days after expansion
    // This way the filters work on the individual slots rather than the original time ranges
    const slotsBeforeWorkDayFilter = processedSlots.length;
    processedSlots = filterByWorkingDays(processedSlots, workDays);
    console.log(`[PIPELINE:STEP3] Working days filter: ${slotsBeforeWorkDayFilter} -> ${processedSlots.length}`);
    // Step 4: Filter by working hours with user's timezone for local time
    const slotsBeforeWorkHoursFilter = processedSlots.length;
    processedSlots = filterByWorkingHours(processedSlots, workingHoursStart, workingHoursEnd, userTimezone);
    console.log(`[PIPELINE:STEP4] Working hours filter: ${slotsBeforeWorkHoursFilter} -> ${processedSlots.length}`);
    // Step 5: Filter by time preference (AM/PM) with user's timezone
    const slotsBeforeTimePreferenceFilter = processedSlots.length;
    processedSlots = filterByTimePreference(processedSlots, timePreference, userTimezone);
    console.log(`[PIPELINE:STEP5] Time preference filter (${timePreference}): ${slotsBeforeTimePreferenceFilter} -> ${processedSlots.length}`);
    // Step 6: Apply buffer alignment filter to ensure proper buffer between slots
    const slotsBeforeBufferFilter = processedSlots.length;
    processedSlots = filterByBufferAlignment(processedSlots, bufferMinutes, userTimezone);
    console.log(`[PIPELINE:STEP6] Buffer alignment filter: ${slotsBeforeBufferFilter} -> ${processedSlots.length}`);
    // Step 7: Filter by calendar availability with buffer time applied
    const slotsBeforeCalendarFilter = processedSlots.length;
    processedSlots = await filterByCalendarAvailability(processedSlots, user, bufferMinutes, userTimezone, meetingDuration, slotInterval, workingHoursStart, workingHoursEnd, debug // Pass the debug flag to see more detailed conflict info
    );
    console.log(`[PIPELINE:STEP7] Calendar availability filter: ${slotsBeforeCalendarFilter} -> ${processedSlots.length}`);
    // Final summary of pipeline stages
    console.log(`[PIPELINE:SUMMARY] Filtering stages:
    Initial: ${slots.length}
    After past filtering: ${slotsBeforePastFilter} -> ${processedSlots.length !== expandedSlots.length
        ? expandedSlots.length
        : "N/A"}
    After slot expansion: ${expandedSlots.length}
    After working days: ${expandedSlots.length} -> ${slotsBeforeWorkHoursFilter}
    After working hours: ${slotsBeforeWorkHoursFilter} -> ${slotsBeforeTimePreferenceFilter}
    After time preference: ${slotsBeforeTimePreferenceFilter} -> ${slotsBeforeBufferFilter}
    After buffer alignment: ${slotsBeforeBufferFilter} -> ${slotsBeforeCalendarFilter}
    After calendar check: ${slotsBeforeCalendarFilter} -> ${processedSlots.length}
  `);
    console.log(`Slot filtering pipeline complete: ${processedSlots.length} slots remaining`);
    return processedSlots;
}
/**
 * Handler for creating a new slot
 * @param req Express request
 * @param res Express response
 */
const handleCreateSlot = async (req, res) => {
    const { start, end, attendeeEmail } = req.body;
    if (!start || !end) {
        return res.status(400).json({ error: "Start and end times are required" });
    }
    // Safe check for authentication
    const isAuth = isUserAuthenticated(req);
    if (!isAuth || !req.user) {
        return res.status(401).json({ error: "Authentication required" });
    }
    try {
        const user = req.user;
        // Create a new slot ID
        const slotId = (0, nanoid_1.nanoid)();
        // Add the slot to the database
        await db_1.db.insert(schema_1.slots).values({
            id: slotId,
            userId: user.id,
            start: new Date(start),
            end: new Date(end),
            confirmed: false,
            attendeeEmail: attendeeEmail || null,
        });
        res.json({
            success: true,
            message: "Slot created successfully",
            slotId,
            slot: {
                id: slotId,
                start,
                end,
                confirmed: false,
                attendeeEmail: attendeeEmail || null,
            },
        });
    }
    catch (error) {
        console.error("Error creating slot:", error);
        res.status(500).json({
            error: "Error creating slot",
            message: error.message || "Unknown error",
        });
    }
};
/**
 * For compatibility with existing code
 * Handler for slot confirmation
 * @param req Express request
 * @param res Express response
 */
const handleSlotConfirmation = async (req, res) => {
    const { id } = req.params;
    // Get parameters from either query (GET) or body (POST)
    const email = req.method === "POST" ? req.body.email : req.query.email;
    const name = req.method === "POST" ? req.body.name : req.query.name;
    const eventTitle = req.method === "POST" ? req.body.eventTitle : req.query.eventTitle;
    if (!id) {
        return res.status(400).json({ error: "Slot ID is required" });
    }
    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }
    // If name is not provided, use email or a generic name
    const attendeeName = name || email.split("@")[0] || "Guest";
    try {
        // This is a public endpoint - no authentication required
        // Just log the authentication status for debugging
        const isAuthenticated = isUserAuthenticated(req);
        console.log("Confirming slot (public endpoint):", {
            id,
            attendeeEmail: email,
            attendeeName: attendeeName,
            eventTitle: eventTitle || null,
            method: req.method,
            isAuthenticated,
            hasUser: !!req.user,
        });
        // Check if the slot already exists in the database first
        const [existingSlot] = await db_1.db
            .select()
            .from(schema_1.slots)
            .where((0, drizzle_orm_1.eq)(schema_1.slots.id, id));
        if (existingSlot) {
            return await handleExistingSlotConfirmation(existingSlot, email, attendeeName, eventTitle, res);
        }
        // Handle date-based or user-prefixed slot IDs
        return await handleSimulatedSlotConfirmation(id, email, attendeeName, eventTitle, res, req // Pass the req object to the function
        );
    }
    catch (error) {
        console.error("Error in handleSlotConfirmation:", error);
        return res.status(500).json({
            error: "Failed to process slot confirmation",
            details: error instanceof Error ? error.message : String(error),
        });
    }
};
/**
 * Handle confirmation for an existing slot
 */
const handleExistingSlotConfirmation = async (existingSlot, email, attendeeName, eventTitle, res) => {
    const calendar = googleapis_1.google.calendar("v3");
    // Handle existing slot
    if (existingSlot.confirmed) {
        return res.status(400).json({ error: "Slot already confirmed" });
    }
    // Update slot with attendee info and pending calendar creation
    await db_1.db
        .update(schema_1.slots)
        .set({
        confirmed: true,
        attendeeEmail: email,
        attendeeName: attendeeName,
        eventTitle: eventTitle || "Meeting via Slot Link",
        pendingCreation: true, // Mark for calendar creation in case of failure
        creationAttempts: 0, // Reset attempts counter
    })
        .where((0, drizzle_orm_1.eq)(schema_1.slots.id, existingSlot.id));
    // Try to create a calendar event if possible
    try {
        const [owner] = await db_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, existingSlot.userId));
        if (owner && owner.accessToken) {
            const auth = (0, google_calendar_utils_1.createGoogleClient)(owner);
            console.log("Creating calendar event with attendee for existing slot:", {
                email: email,
                name: attendeeName,
                sendUpdates: "all",
            });
            // Generate event title based on participant names if not explicitly provided
            if (!eventTitle && attendeeName) {
                // Format: "Guest <> Host" - the guest name comes first
                const hostName = owner.email.split("@")[0];
                eventTitle = `${attendeeName} <> ${hostName}`;
            }
            // Always add 🪄 emoji to events created via calendar link
            // This is for direct link confirmations like https://app.meetalphie.com/calendar/slot/[slotID]
            console.log(`Adding magic wand emoji to event title for slot from calendar link`);
            eventTitle = `🪄 ${eventTitle || "Meeting via Slot Link"}`;
            // Get user's video conferencing link if available
            const [userData] = await db_1.db
                .select({
                videoLink: schema_1.users.videoLink,
            })
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, existingSlot.userId));
            // Prepare description with video link if available
            let description = 'This meeting was scheduled with Alphie – the AI meeting assistant that understands you.\n<a href="https://meetalphie.com/">Get Alphie for yourself</a> and make all your scheduling 1-click';
            if (userData === null || userData === void 0 ? void 0 : userData.videoLink) {
                description = `Join the meeting using this video conferencing link: ${userData.videoLink}\n\n${description}`;
            }
            const requestBody = {
                summary: eventTitle,
                // Add Alphie branding and video link to calendar event description
                description,
                start: {
                    dateTime: new Date(existingSlot.start).toISOString(),
                },
                end: {
                    dateTime: new Date(existingSlot.end).toISOString(),
                },
                attendees: [
                    // Always include the host/owner with self property to ensure they appear in attendees list
                    {
                        email: owner.email,
                        self: true,
                        responseStatus: "accepted",
                        organizer: true,
                    },
                    { email: email, displayName: attendeeName },
                ],
                // Set creator and organizer explicitly to the host
                creator: { email: owner.email, self: true },
                organizer: { email: owner.email, self: true },
            };
            const calResponse = await calendar.events.insert({
                auth,
                calendarId: "primary",
                sendUpdates: "all", // Ensure this parameter is passed at the top level
                requestBody,
                conferenceDataVersion: 1,
                sendNotifications: true,
                supportsAttachments: true,
            });
            console.log("Calendar event created for existing slot:", {
                eventId: calResponse.data.id,
                status: calResponse.data.status,
                htmlLink: calResponse.data.htmlLink,
            });
            // Update slot with eventId and set calendarCreated = true
            await db_1.db
                .update(schema_1.slots)
                .set({
                eventId: calResponse.data.id,
                calendarCreated: true,
                pendingCreation: false,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.slots.id, existingSlot.id));
            return res.json({
                success: true,
                calendarCreated: true,
                message: "Slot confirmed with calendar event",
                slot: {
                    id: existingSlot.id,
                    start: existingSlot.start,
                    end: existingSlot.end,
                    confirmed: true,
                    attendeeEmail: email,
                    attendeeName: attendeeName,
                    eventId: calResponse.data.id,
                },
            });
        }
    }
    catch (calendarError) {
        // Calendar creation failed, but slot was updated
        console.error("Calendar creation failed for existing slot:", calendarError);
    }
    // Return success even if calendar creation failed
    return res.json({
        success: true,
        calendarCreated: false,
        message: "Slot confirmed successfully",
        slot: {
            id: existingSlot.id,
            start: existingSlot.start,
            end: existingSlot.end,
            confirmed: true,
            attendeeEmail: email,
            attendeeName: attendeeName,
        },
    });
};
/**
 * Handle confirmation for simulated slots (date-based IDs)
 */
const handleSimulatedSlotConfirmation = async (id, email, attendeeName, eventTitle, res, req // Add req as an optional parameter
) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const calendar = googleapis_1.google.calendar("v3");
    let dateStr;
    let timeStr;
    let targetUserId = null;
    // We'll set a default timezone but will always try to get the user's actual timezone first
    let userTimezone = "America/Los_Angeles"; // Default timezone as fallback
    // Get time format and timezone information from request
    const timeFormat = ((_a = req === null || req === void 0 ? void 0 : req.body) === null || _a === void 0 ? void 0 : _a.timeFormat) || "ORIGINAL"; // Default to original if not specified
    const providedTimezone = (_b = req === null || req === void 0 ? void 0 : req.body) === null || _b === void 0 ? void 0 : _b.timezone; // Timezone provided by the client
    // If a timezone is provided by the client, use it
    if (providedTimezone) {
        console.log(`Using client-provided timezone: ${providedTimezone}`);
        userTimezone = providedTimezone;
    }
    // Check if the request body contains explicit start and end times
    let providedStartTime = ((_c = req === null || req === void 0 ? void 0 : req.body) === null || _c === void 0 ? void 0 : _c.startTime)
        ? new Date(req.body.startTime)
        : null;
    let providedEndTime = ((_d = req === null || req === void 0 ? void 0 : req.body) === null || _d === void 0 ? void 0 : _d.endTime) ? new Date(req.body.endTime) : null;
    // Validate the provided times
    const areTimesValid = providedStartTime &&
        providedEndTime &&
        !isNaN(providedStartTime.getTime()) &&
        !isNaN(providedEndTime.getTime());
    if (areTimesValid) {
        console.log("Using provided start and end times:", {
            startTime: providedStartTime === null || providedStartTime === void 0 ? void 0 : providedStartTime.toISOString(),
            endTime: providedEndTime === null || providedEndTime === void 0 ? void 0 : providedEndTime.toISOString(),
            timeFormat,
            timezone: userTimezone,
            duration: providedEndTime && providedStartTime
                ? (providedEndTime.getTime() - providedStartTime.getTime()) /
                    (60 * 1000) +
                    " minutes"
                : "unknown",
        });
    }
    // Check for user-prefixed format (u{userId}-{dateId})
    const userPrefixMatch = id.match(/^u(\d+)-(\d{8}-\d{4})$/);
    if (userPrefixMatch) {
        // Extract user ID and date part
        targetUserId = parseInt(userPrefixMatch[1]);
        const pureDateId = userPrefixMatch[2];
        console.log("Handling user-prefixed ID confirmation:", {
            userId: targetUserId,
            pureDateId,
        });
        // Extract date from the pure date part
        const year = pureDateId.substring(0, 4);
        const month = pureDateId.substring(4, 6);
        const day = pureDateId.substring(6, 8);
        const hour = pureDateId.substring(9, 11);
        const minute = pureDateId.substring(11, 13);
        dateStr = `${year}-${month}-${day}`;
        timeStr = `${hour}:${minute}:00`;
    }
    // Handle date-based IDs (simulated slots)
    else if (id.match(/^\d{8}-\d{4}$/)) {
        // For date-based simulated slots
        const year = id.substring(0, 4);
        const month = id.substring(4, 6);
        const day = id.substring(6, 8);
        const hour = id.substring(9, 11);
        const minute = id.substring(11, 13);
        dateStr = `${year}-${month}-${day}`;
        timeStr = `${hour}:${minute}:00`;
        console.log("Handling date-based ID:", { id, dateStr, timeStr });
    }
    // Handle nanoid-based IDs (from reply mode)
    else if (id.match(/^[A-Za-z0-9_-]{21}$/)) {
        // For nanoid-based IDs from the reply mode
        console.log("Handling nanoid-based ID from reply mode:", id);
        // Since this is a nanoid from reply mode, check if it's stored as a linkId in an existing slot
        const [existingLinkSlot] = await db_1.db
            .select()
            .from(schema_1.slots)
            .where((0, drizzle_orm_1.eq)(schema_1.slots.linkId, id))
            .limit(1);
        if (existingLinkSlot) {
            console.log("Found existing slot with linkId:", id, {
                slotId: existingLinkSlot.id,
                start: existingLinkSlot.start,
                end: existingLinkSlot.end,
                duration: existingLinkSlot.duration,
            });
            // Use the dates from the existing slot
            dateStr = (0, moment_timezone_1.default)(existingLinkSlot.start).format("YYYY-MM-DD");
            timeStr = (0, moment_timezone_1.default)(existingLinkSlot.start).format("HH:mm:ss");
            // Check if this slot has a stored meeting duration (from email extraction)
            if (existingLinkSlot.duration) {
                console.log(`Using extracted meeting duration from slot: ${existingLinkSlot.duration} minutes`);
                // Store the meeting duration to use it later when calculating the end time
                if (req) {
                    req.body.extractedMeetingDuration = existingLinkSlot.duration;
                }
            }
        }
        else {
            // If no existing slot found with this linkId, use default date/time
            // since we don't have access to the request object
            let startTime, endTime, selectedDate, selectedTime;
            // Check if we have req parameter available
            if (req) {
                startTime =
                    req.method === "POST" ? req.body.startTime : req.query.startTime;
                endTime = req.method === "POST" ? req.body.endTime : req.query.endTime;
                selectedDate =
                    req.method === "POST"
                        ? req.body.selectedDate
                        : req.query.selectedDate;
                selectedTime =
                    req.method === "POST"
                        ? req.body.selectedTime
                        : req.query.selectedTime;
            }
            if (startTime && endTime) {
                // Use the provided start and end times
                const providedStart = new Date(startTime);
                if (!isNaN(providedStart.getTime())) {
                    dateStr = (0, moment_timezone_1.default)(providedStart).format("YYYY-MM-DD");
                    timeStr = (0, moment_timezone_1.default)(providedStart).format("HH:mm:ss");
                    console.log("Using provided start time for nanoid slot:", {
                        id,
                        dateStr,
                        timeStr,
                        startTime,
                        endTime,
                        attendeeEmail: email,
                        attendeeName: attendeeName,
                    });
                }
                else {
                    // Fallback to tomorrow if invalid time format
                    const now = new Date();
                    const tomorrow = new Date(now);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    dateStr = tomorrow.toISOString().split("T")[0];
                    timeStr = now.toISOString().split("T")[1].substring(0, 8);
                }
            }
            else if (selectedDate && selectedTime) {
                // Use the selected date and time from the AI analysis
                // Format: YYYY-MM-DD and HH:MM
                try {
                    dateStr = selectedDate;
                    timeStr = `${selectedTime}:00`;
                    console.log("Using selected date and time for nanoid slot:", {
                        id,
                        dateStr,
                        timeStr,
                        selectedDate,
                        selectedTime,
                        attendeeEmail: email,
                        attendeeName: attendeeName,
                    });
                }
                catch (parseError) {
                    console.error("Error parsing selected date and time:", parseError);
                    // Fallback to tomorrow if parsing fails
                    const now = new Date();
                    const tomorrow = new Date(now);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    dateStr = tomorrow.toISOString().split("T")[0];
                    timeStr = now.toISOString().split("T")[1].substring(0, 8);
                }
            }
            else {
                // If no time data provided:
                // Schedule the meeting for a reasonable time (use current time + 1 day at same hour)
                const now = new Date();
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                // Format the date and time for moment.js
                dateStr = tomorrow.toISOString().split("T")[0];
                // Keep the current time part
                timeStr = now.toISOString().split("T")[1].substring(0, 8);
                console.log("Using tomorrow same time for nanoid slot (no time data provided):", {
                    id,
                    dateStr,
                    timeStr,
                    attendeeEmail: email,
                    attendeeName: attendeeName,
                });
            }
        }
    }
    else {
        console.error("Invalid slot ID format:", id);
        return res.status(400).json({
            error: "Invalid slot ID format",
            message: "The provided slot ID doesn't match any known format.",
        });
    }
    // Find target user BEFORE calculating the time - critical for proper timezone handling
    // If we have a target user ID from a prefixed link, use that specific user
    // Otherwise, find the first active user to create the calendar event
    let targetUser;
    if (targetUserId) {
        // Use the user ID extracted from the prefixed link format
        [targetUser] = await db_1.db
            .select({
            id: schema_1.users.id,
            email: schema_1.users.email,
            accessToken: schema_1.users.accessToken,
            refreshToken: schema_1.users.refreshToken,
            timezone: schema_1.users.timezone,
            videoLink: schema_1.users.videoLink,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, targetUserId));
        console.log(`Using specified user ID ${targetUserId} from prefixed link:`, !!targetUser);
    }
    // If no target user was found or specified, check for authenticated user or use generic fallback
    if (!targetUser) {
        // First, check if this is a reply mode request with an authenticated user
        if (req === null || req === void 0 ? void 0 : req.user) {
            const authenticatedUser = req.user;
            [targetUser] = await db_1.db
                .select({
                id: schema_1.users.id,
                email: schema_1.users.email,
                accessToken: schema_1.users.accessToken,
                refreshToken: schema_1.users.refreshToken,
                timezone: schema_1.users.timezone,
                videoLink: schema_1.users.videoLink,
            })
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, authenticatedUser.id))
                .limit(1);
            console.log("Using authenticated user from request:", {
                userId: targetUser === null || targetUser === void 0 ? void 0 : targetUser.id,
                email: targetUser === null || targetUser === void 0 ? void 0 : targetUser.email,
                hasAccessToken: !!(targetUser === null || targetUser === void 0 ? void 0 : targetUser.accessToken),
                hasRefreshToken: !!(targetUser === null || targetUser === void 0 ? void 0 : targetUser.refreshToken),
            });
        }
        // If still no user (no authenticated user or couldn't find them in DB), use generic fallback
        if (!targetUser) {
            // Get the first available user that's not olena@h34rt.ai
            [targetUser] = await db_1.db
                .select({
                id: schema_1.users.id,
                email: schema_1.users.email,
                accessToken: schema_1.users.accessToken,
                refreshToken: schema_1.users.refreshToken,
                timezone: schema_1.users.timezone,
                videoLink: schema_1.users.videoLink,
            })
                .from(schema_1.users)
                .where((0, drizzle_orm_1.sql) `${schema_1.users.email} != 'olena@h34rt.ai'`)
                .limit(1);
            // Final fallback to any user if needed (but this should rarely happen)
            if (!targetUser) {
                // If we still couldn't find any other user, get any user as last resort
                [targetUser] = await db_1.db
                    .select({
                    id: schema_1.users.id,
                    email: schema_1.users.email,
                    accessToken: schema_1.users.accessToken,
                    refreshToken: schema_1.users.refreshToken,
                    timezone: schema_1.users.timezone,
                    videoLink: schema_1.users.videoLink,
                })
                    .from(schema_1.users)
                    .limit(1);
            }
            console.log("Using fallback user (not olena@h34rt.ai):", {
                userId: targetUser === null || targetUser === void 0 ? void 0 : targetUser.id,
                email: targetUser === null || targetUser === void 0 ? void 0 : targetUser.email,
                hasAccessToken: !!(targetUser === null || targetUser === void 0 ? void 0 : targetUser.accessToken),
                hasRefreshToken: !!(targetUser === null || targetUser === void 0 ? void 0 : targetUser.refreshToken),
            });
        }
    }
    // Use the user's timezone if available, otherwise keep the default
    if (targetUser && targetUser.timezone) {
        userTimezone = targetUser.timezone;
        console.log(`Using user's timezone: ${userTimezone}`);
    }
    else {
        console.log(`Using default timezone: ${userTimezone}`);
    }
    // If we have valid provided start and end times, use those directly
    let startTime, endTime;
    if (areTimesValid && providedStartTime && providedEndTime) {
        // Handle differently based on the time format provided by the extension
        if (timeFormat === "UTC") {
            // For UTC times, interpret them correctly as UTC
            console.log("Processing UTC times with proper timezone conversion");
            // Convert from UTC to the user's timezone for display consistency
            startTime = moment_timezone_1.default.utc(providedStartTime).tz(userTimezone).toDate();
            endTime = moment_timezone_1.default.utc(providedEndTime).tz(userTimezone).toDate();
        }
        else if (timeFormat === "LOCAL") {
            // For LOCAL format, the times are already in the specified timezone
            console.log(`Processing local times in ${userTimezone} timezone`);
            // Create a moment in the specific timezone
            startTime = moment_timezone_1.default
                .tz((0, moment_timezone_1.default)(providedStartTime).format("YYYY-MM-DDTHH:mm:ss"), userTimezone)
                .toDate();
            endTime = moment_timezone_1.default
                .tz((0, moment_timezone_1.default)(providedEndTime).format("YYYY-MM-DDTHH:mm:ss"), userTimezone)
                .toDate();
        }
        else {
            // For ORIGINAL or other formats, use as provided but ensure timezone
            console.log(`Processing times in format ${timeFormat} with timezone ${userTimezone}`);
            startTime = providedStartTime;
            endTime = providedEndTime;
        }
        console.log("Using provided times from request with format handling:", {
            timeFormat,
            timezone: userTimezone,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
        });
    }
    else {
        // Format the start time in the user's timezone - AFTER getting the correct timezone
        startTime = moment_timezone_1.default.tz(dateStr + "T" + timeStr, userTimezone).toDate();
        // Check if we have an extracted meeting duration from the email (highest priority)
        let meetingDuration = 60; // Default to 60 minutes
        // First check if we have extracted duration from the request body (from nanoid slot lookup)
        if (req && req.body && req.body.extractedMeetingDuration) {
            meetingDuration = req.body.extractedMeetingDuration;
            console.log(`Using meeting duration from email extraction: ${meetingDuration} minutes`);
        }
        else {
            // If no extracted duration, try to get the user's preferred meeting duration from preferences
            try {
                // Get user preferences if available
                if (targetUser === null || targetUser === void 0 ? void 0 : targetUser.id) {
                    const [userPrefs] = await db_1.db
                        .select()
                        .from(schema_1.preferences)
                        .where((0, drizzle_orm_1.eq)(schema_1.preferences.userId, targetUser.id));
                    if (userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.meetingDuration) {
                        meetingDuration = userPrefs.meetingDuration;
                        console.log(`Using user's preferred meeting duration: ${meetingDuration} minutes`);
                    }
                }
            }
            catch (prefsError) {
                console.warn("Error getting user preferences:", prefsError);
                // Continue with default duration
            }
        }
        // Calculate end time based on the meeting duration
        endTime = (0, moment_timezone_1.default)(startTime).add(meetingDuration, "minutes").toDate();
        console.log(`Using calculated end time with ${meetingDuration} minutes duration`);
    }
    console.log("Creating calendar event for slot:", {
        slotId: id,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        attendeeEmail: email,
        attendeeName: attendeeName,
        timezone: userTimezone,
    });
    if (!targetUser) {
        return res
            .status(500)
            .json({ error: "No users found to create calendar event" });
    }
    // Create a new slot record in the database
    const newSlotId = (0, nanoid_1.nanoid)();
    try {
        // Try to create a calendar event if possible
        if (targetUser.accessToken) {
            try {
                // Generate event title based on participant names if not explicitly provided
                if (!eventTitle && attendeeName) {
                    // Format: "Guest <> Host" - the guest name comes first
                    const hostName = targetUser.email.split("@")[0];
                    eventTitle = `${attendeeName} <> ${hostName}`;
                }
                // Always add 🪄 emoji to events created via calendar link
                // This is for direct link confirmations like https://app.meetalphie.com/calendar/slot/[slotID]
                console.log(`Adding magic wand emoji to event title for slot ${newSlotId} from calendar link`);
                eventTitle = `🪄 ${eventTitle || "Meeting via Slot Link"}`;
                const auth = (0, google_calendar_utils_1.createGoogleClient)(targetUser);
                // Always preserve local time for consistent behavior
                let startDateTime, endDateTime;
                // For all slots, preserve local time exactly in the user's timezone
                console.log(`Preserving local time in ${userTimezone} timezone for calendar event`);
                // Format start/end times with proper timezone handling based on the format
                let startMoment, endMoment;
                // Explicitly log the time format we're processing
                console.log(`Processing times with format ${timeFormat} for calendar event`);
                if (timeFormat === "UTC" &&
                    ((_e = req === null || req === void 0 ? void 0 : req.body) === null || _e === void 0 ? void 0 : _e.startTime) &&
                    ((_f = req === null || req === void 0 ? void 0 : req.body) === null || _f === void 0 ? void 0 : _f.endTime)) {
                    // For UTC times, preserve the UTC time but ensure proper formatting
                    console.log("Preserving UTC times for calendar event while ensuring proper format");
                    // First parse the times in UTC
                    startMoment = moment_timezone_1.default.utc(req.body.startTime);
                    endMoment = moment_timezone_1.default.utc(req.body.endTime);
                    // Very important: UTC times must be formatted WITH the 'Z' suffix for Google Calendar
                    startDateTime = startMoment.format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    endDateTime = endMoment.format("YYYY-MM-DDTHH:mm:ss") + "Z";
                    console.log("Using UTC format with Z suffix:", {
                        startDateTime,
                        endDateTime,
                        userTimezone,
                    });
                }
                else {
                    // For all other formats, use local time in the user's timezone
                    console.log(`Using local time in timezone: ${userTimezone}`);
                    // Parse in the user's timezone
                    startMoment = moment_timezone_1.default.tz(startTime, userTimezone);
                    endMoment = moment_timezone_1.default.tz(endTime, userTimezone);
                    // Format for local time (ISO 8601 without Z suffix)
                    startDateTime = startMoment.format("YYYY-MM-DDTHH:mm:ss");
                    endDateTime = endMoment.format("YYYY-MM-DDTHH:mm:ss");
                }
                console.log(`Local time preserved: ${startDateTime} - ${endDateTime} in ${userTimezone}`);
                // Additional timezone debugging for event creation
                console.log("TIMEZONE DEBUG - Calendar event creation:", {
                    timeFormat,
                    startTimeFromRequest: (_g = req === null || req === void 0 ? void 0 : req.body) === null || _g === void 0 ? void 0 : _g.startTime,
                    endTimeFromRequest: (_h = req === null || req === void 0 ? void 0 : req.body) === null || _h === void 0 ? void 0 : _h.endTime,
                    providedTimezone: (_j = req === null || req === void 0 ? void 0 : req.body) === null || _j === void 0 ? void 0 : _j.timezone,
                    userTimezone,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    formattedStartDateTime: startDateTime,
                    formattedEndDateTime: endDateTime,
                    userLocaleTime: new Date().toLocaleString("en-US", {
                        timeZone: userTimezone,
                    }),
                });
                // We're now careful about timezone handling earlier in the process,
                // so we can just use the properly formatted datetime strings directly
                const finalStartDateTime = startDateTime;
                const finalEndDateTime = endDateTime;
                console.log("Final calendar event times:", {
                    startDateTime: finalStartDateTime,
                    endDateTime: finalEndDateTime,
                    hasZSuffix: finalStartDateTime.includes("Z"),
                    userTimezone,
                });
                // Prepare description with video link if available
                let description = 'This meeting was scheduled with Alphie – the AI meeting assistant that understands you.\n<a href="https://meetalphie.com/">Get Alphie for yourself</a> and make all your scheduling 1-click';
                if (targetUser.videoLink) {
                    description = `Join the meeting using this video conferencing link: ${targetUser.videoLink}\n\n${description}`;
                }
                const event = {
                    summary: eventTitle,
                    // Add Alphie branding and video link to calendar event description
                    description,
                    start: {
                        dateTime: finalStartDateTime,
                        timeZone: userTimezone,
                    },
                    end: {
                        dateTime: finalEndDateTime,
                        timeZone: userTimezone,
                    },
                    attendees: [
                        // Always include the host/owner with self property to ensure they appear in attendees list
                        {
                            email: targetUser.email,
                            self: true,
                            responseStatus: "accepted",
                            organizer: true,
                        },
                        { email: email, displayName: attendeeName },
                    ],
                    // Set creator and organizer explicitly to the host
                    creator: { email: targetUser.email, self: true },
                    organizer: { email: targetUser.email, self: true },
                };
                console.log("Creating calendar event with attendee:", {
                    email: email,
                    name: attendeeName,
                    sendUpdates: "all",
                });
                const createdEvent = await calendar.events.insert({
                    auth,
                    calendarId: "primary",
                    sendUpdates: "all", // Ensure this parameter is passed at the top level
                    requestBody: event,
                    conferenceDataVersion: 1,
                    sendNotifications: true,
                    supportsAttachments: true,
                });
                console.log("Calendar event created:", {
                    eventId: createdEvent.data.id,
                    status: createdEvent.data.status,
                    htmlLink: createdEvent.data.htmlLink,
                });
                // Insert slot with event ID
                await db_1.db.insert(schema_1.slots).values({
                    id: newSlotId,
                    userId: targetUser.id,
                    start: startTime,
                    end: endTime,
                    confirmed: true,
                    attendeeEmail: email,
                    attendeeName: attendeeName,
                    eventId: createdEvent.data.id,
                    eventTitle: eventTitle, // Store the generated or provided title
                    simulatedId: id, // Store the original ID for reference
                    linkId: id.match(/^[A-Za-z0-9_-]{21}$/) ? id : undefined, // Store link ID only for nanoid format
                    duration: ((_k = req === null || req === void 0 ? void 0 : req.body) === null || _k === void 0 ? void 0 : _k.duration) || null, // Include extracted meeting duration if available
                });
                return res.json({
                    success: true,
                    calendarCreated: true,
                    message: "Calendar event created successfully",
                    slotId: newSlotId,
                    originalId: id,
                    eventId: createdEvent.data.id,
                    event: {
                        start: startTime.toISOString(),
                        end: endTime.toISOString(),
                        timezone: userTimezone,
                        attendeeEmail: email,
                        attendeeName: attendeeName,
                        title: eventTitle || "Meeting via Slot Link",
                    },
                });
            }
            catch (calendarError) {
                console.error("Calendar creation failed for new slot:", calendarError);
                // Continue with slot creation without calendar event
            }
        }
        // Create slot without event ID (calendar creation failed or wasn't attempted)
        // Make sure calendar creation will be attempted later through the background service
        await db_1.db.insert(schema_1.slots).values({
            id: newSlotId,
            userId: targetUser.id,
            start: startTime,
            end: endTime,
            confirmed: true,
            attendeeEmail: email,
            attendeeName: attendeeName,
            eventTitle: eventTitle, // Store the generated or provided title
            simulatedId: id, // Store the original ID for reference
            linkId: id.match(/^[A-Za-z0-9_-]{21}$/) ? id : undefined, // Store link ID only for nanoid format
            duration: ((_l = req === null || req === void 0 ? void 0 : req.body) === null || _l === void 0 ? void 0 : _l.duration) || null, // Include extracted meeting duration if available
            pendingCreation: true, // Mark for calendar creation through background service
            creationAttempts: 0, // Initialize attempts counter
        });
        // Try to queue a calendar event creation using the background service
        try {
            const { queueCalendarEventCreation } = await Promise.resolve().then(() => __importStar(require("./calendar-background-service")));
            await queueCalendarEventCreation(newSlotId);
            console.log(`Queued calendar event creation for slot ${newSlotId}`);
        }
        catch (queueError) {
            console.error(`Failed to queue calendar event creation:`, queueError);
            // Continue anyway, it will be picked up by the background job
        }
        return res.json({
            success: true,
            calendarCreated: false,
            message: "Slot created successfully. Calendar event will be created shortly.",
            slotId: newSlotId,
            originalId: id,
            event: {
                start: startTime.toISOString(),
                end: endTime.toISOString(),
                timezone: userTimezone,
                attendeeEmail: email,
                attendeeName: attendeeName,
                title: eventTitle || "Meeting via Slot Link",
            },
        });
    }
    catch (error) {
        console.error("Error creating slot:", error);
        return res.status(500).json({
            error: "Failed to create slot",
            details: error instanceof Error ? error.message : String(error),
        });
    }
};
/**
 * Handler for getting slot details
 * @param req Express request
 * @param res Express response
 */
const handleGetSlotDetails = async (req, res) => {
    var _a, _b;
    const { id } = req.params;
    const calendar = googleapis_1.google.calendar("v3");
    if (!id) {
        console.error("Missing slot ID in request");
        return res.status(400).json({ error: "Slot ID is required" });
    }
    try {
        // This is a public endpoint - authentication is logged but not required
        // Just track the authentication status for analytics
        const isAuthenticated = isUserAuthenticated(req);
        console.log("Fetching slot details (public endpoint):", {
            id,
            isAuthenticated,
            hasUser: !!req.user,
        });
        // Handle different slot ID formats
        let slot = null;
        let pureDateId = null;
        let userId = null;
        // First try to find by exact ID
        const [exactIdSlot] = await db_1.db
            .select({
            id: schema_1.slots.id,
            userId: schema_1.slots.userId,
            start: schema_1.slots.start,
            end: schema_1.slots.end,
            confirmed: schema_1.slots.confirmed,
            attendeeEmail: schema_1.slots.attendeeEmail,
            attendeeName: schema_1.slots.attendeeName,
            eventTitle: schema_1.slots.eventTitle,
            eventId: schema_1.slots.eventId,
            calendarCreated: schema_1.slots.calendarCreated,
            linkId: schema_1.slots.linkId,
            duration: schema_1.slots.duration, // Include the duration field
        })
            .from(schema_1.slots)
            .where((0, drizzle_orm_1.eq)(schema_1.slots.id, id));
        if (exactIdSlot) {
            slot = exactIdSlot;
        }
        else {
            // Try to find by simulatedId or linkId
            const [matchingSlot] = await db_1.db
                .select({
                id: schema_1.slots.id,
                userId: schema_1.slots.userId,
                start: schema_1.slots.start,
                end: schema_1.slots.end,
                confirmed: schema_1.slots.confirmed,
                attendeeEmail: schema_1.slots.attendeeEmail,
                attendeeName: schema_1.slots.attendeeName,
                eventTitle: schema_1.slots.eventTitle,
                eventId: schema_1.slots.eventId,
                calendarCreated: schema_1.slots.calendarCreated,
                linkId: schema_1.slots.linkId,
                duration: schema_1.slots.duration, // Include the duration field
            })
                .from(schema_1.slots)
                .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.slots.simulatedId, id), (0, drizzle_orm_1.eq)(schema_1.slots.linkId, id)));
            if (matchingSlot) {
                slot = matchingSlot;
            }
            else {
                // Try to handle user-prefixed format (u{userId}-{dateId})
                const userPrefixMatch = id.match(/^u(\d+)-(\d{8}-\d{4})$/);
                if (userPrefixMatch) {
                    // Extract user ID and date part
                    userId = parseInt(userPrefixMatch[1]);
                    pureDateId = userPrefixMatch[2];
                    console.log("Detected user-prefixed slot ID:", {
                        userId,
                        pureDateId,
                    });
                    // Extract date from the pure date part
                    if (pureDateId) {
                        const year = pureDateId.substring(0, 4);
                        const month = pureDateId.substring(4, 6);
                        const day = pureDateId.substring(6, 8);
                        const hour = pureDateId.substring(9, 11);
                        const minute = pureDateId.substring(11, 13);
                        const dateStr = `${year}-${month}-${day}`;
                        const timeStr = `${hour}:${minute}:00`;
                        // Try to get user's timezone
                        let userTimezone = "America/Los_Angeles"; // Default timezone as fallback
                        try {
                            if (userId) {
                                // Try to get the user's timezone
                                const [userData] = await db_1.db
                                    .select()
                                    .from(schema_1.users)
                                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
                                if (userData && userData.timezone) {
                                    userTimezone = userData.timezone;
                                    console.log(`Using user's timezone: ${userTimezone}`);
                                }
                                else {
                                    console.log(`Using default timezone: ${userTimezone}`);
                                }
                            }
                        }
                        catch (err) {
                            console.warn("Error getting user timezone:", err);
                            // Continue with default
                        }
                        // Format the start and end times
                        const startTime = moment_timezone_1.default
                            .tz(dateStr + "T" + timeStr, userTimezone)
                            .toDate();
                        // Try to get the user's preferred meeting duration from preferences
                        let meetingDuration = 60; // Default to 60 minutes
                        try {
                            // Get user preferences if available
                            if (userId) {
                                const [userPrefs] = await db_1.db
                                    .select()
                                    .from(schema_1.preferences)
                                    .where((0, drizzle_orm_1.eq)(schema_1.preferences.userId, userId));
                                if (userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.meetingDuration) {
                                    meetingDuration = userPrefs.meetingDuration;
                                    console.log(`Using user's preferred meeting duration: ${meetingDuration} minutes`);
                                }
                            }
                        }
                        catch (prefsError) {
                            console.warn("Error getting user preferences:", prefsError);
                            // Continue with default duration
                        }
                        // Calculate end time based on the meeting duration preference
                        const endTime = (0, moment_timezone_1.default)(startTime)
                            .add(meetingDuration, "minutes")
                            .toDate();
                        slot = {
                            id,
                            userId,
                            start: startTime,
                            end: endTime,
                            confirmed: false,
                            attendeeEmail: null,
                            attendeeName: null,
                            eventTitle: "Meeting",
                            isSimulated: true,
                        };
                    }
                }
                else if (id.match(/^\d{8}-\d{4}$/)) {
                    // Handle simple date-based format (e.g., 20250307-0900)
                    // Extract date and time parts
                    const year = id.substring(0, 4);
                    const month = id.substring(4, 6);
                    const day = id.substring(6, 8);
                    const hour = id.substring(9, 11);
                    const minute = id.substring(11, 13);
                    const dateStr = `${year}-${month}-${day}`;
                    const timeStr = `${hour}:${minute}:00`;
                    // Default to America/Los_Angeles timezone if not specified
                    let userTimezone = "America/Los_Angeles"; // Default timezone as fallback
                    // Get timezone from authenticated user if available or any other user
                    try {
                        // First check if we have an authenticated user
                        if (req === null || req === void 0 ? void 0 : req.user) {
                            const authenticatedUser = req.user;
                            const [authUser] = await db_1.db
                                .select()
                                .from(schema_1.users)
                                .where((0, drizzle_orm_1.eq)(schema_1.users.id, authenticatedUser.id))
                                .limit(1);
                            if (authUser === null || authUser === void 0 ? void 0 : authUser.timezone) {
                                userTimezone = authUser.timezone;
                                console.log(`Using authenticated user's timezone: ${userTimezone}`);
                            }
                        }
                        else {
                            // Otherwise get any user (excluding olena@h34rt.ai if possible)
                            const [anyUser] = await db_1.db
                                .select()
                                .from(schema_1.users)
                                .where((0, drizzle_orm_1.sql) `${schema_1.users.email} != 'olena@h34rt.ai'`)
                                .limit(1);
                            if (!anyUser) {
                                // Final fallback to any user
                                const [fallbackUser] = await db_1.db.select().from(schema_1.users).limit(1);
                                if (fallbackUser === null || fallbackUser === void 0 ? void 0 : fallbackUser.timezone) {
                                    userTimezone = fallbackUser.timezone;
                                    console.log(`Using fallback user's timezone: ${userTimezone}`);
                                }
                            }
                            else if (anyUser === null || anyUser === void 0 ? void 0 : anyUser.timezone) {
                                userTimezone = anyUser.timezone;
                                console.log(`Using other user's timezone: ${userTimezone}`);
                            }
                            else {
                                console.log(`Using default timezone: ${userTimezone}`);
                            }
                        }
                    }
                    catch (err) {
                        console.warn("Error getting user timezone:", err);
                        // Continue with default
                    }
                    const localDateStr = `${dateStr}T${timeStr}`;
                    // Use moment.js to handle timezone conversions
                    const startTime = moment_timezone_1.default.tz(localDateStr, userTimezone).toDate();
                    // Try to get the default user's preferred meeting duration
                    let meetingDuration = 60; // Default to 60 minutes
                    try {
                        // Try to get user preferences based on the request user or any available user
                        let defaultUser = null;
                        // First check for authenticated user
                        if (req === null || req === void 0 ? void 0 : req.user) {
                            const authenticatedUser = req.user;
                            [defaultUser] = await db_1.db
                                .select()
                                .from(schema_1.users)
                                .where((0, drizzle_orm_1.eq)(schema_1.users.id, authenticatedUser.id))
                                .limit(1);
                        }
                        // If no authenticated user, use any user except olena@h34rt.ai
                        if (!defaultUser) {
                            [defaultUser] = await db_1.db
                                .select()
                                .from(schema_1.users)
                                .where((0, drizzle_orm_1.sql) `${schema_1.users.email} != 'olena@h34rt.ai'`)
                                .limit(1);
                        }
                        // Final fallback to any user
                        if (!defaultUser) {
                            [defaultUser] = await db_1.db.select().from(schema_1.users).limit(1);
                        }
                        if (defaultUser) {
                            // Get user preferences
                            const [userPrefs] = await db_1.db
                                .select()
                                .from(schema_1.preferences)
                                .where((0, drizzle_orm_1.eq)(schema_1.preferences.userId, defaultUser.id));
                            if (userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.meetingDuration) {
                                meetingDuration = userPrefs.meetingDuration;
                                console.log(`Using default user's preferred meeting duration: ${meetingDuration} minutes`);
                            }
                        }
                    }
                    catch (prefsError) {
                        console.warn("Error getting user preferences:", prefsError);
                        // Continue with default duration
                    }
                    // Calculate end time based on the meeting duration preference
                    const endTime = (0, moment_timezone_1.default)(startTime)
                        .add(meetingDuration, "minutes")
                        .toDate();
                    console.log("Creating simulated slot for date ID:", {
                        id,
                        dateStr,
                        timeStr,
                        startTime,
                        endTime,
                    });
                    // Return a simulated slot for this date-time ID
                    slot = {
                        id: id,
                        userId: null,
                        start: startTime,
                        end: endTime,
                        confirmed: false,
                        attendeeEmail: null,
                        attendeeName: null,
                        eventTitle: "Meeting",
                        isSimulated: true, // Flag to indicate this is a simulated slot
                    };
                }
                else if (id.match(/^[A-Za-z0-9_-]{21}$/)) {
                    // Handle nanoid-based format (from reply mode in extension)
                    console.log("Handling nanoid-based ID from reply mode:", id);
                    // We need to create a slot based on the current time since we don't have date info
                    const now = new Date();
                    const startTime = now;
                    // Try to get a default meeting duration from any user's preferences
                    let meetingDuration = 60; // Default to 60 minutes
                    try {
                        // Try to find a default user for preferences
                        const [defaultUser] = await db_1.db.select().from(schema_1.users).limit(1);
                        if (defaultUser) {
                            // Get user preferences
                            const [userPrefs] = await db_1.db
                                .select()
                                .from(schema_1.preferences)
                                .where((0, drizzle_orm_1.eq)(schema_1.preferences.userId, defaultUser.id));
                            if (userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.meetingDuration) {
                                meetingDuration = userPrefs.meetingDuration;
                                console.log(`Using default user's preferred meeting duration: ${meetingDuration} minutes`);
                            }
                        }
                    }
                    catch (prefsError) {
                        console.warn("Error getting user preferences:", prefsError);
                        // Continue with default duration
                    }
                    // Calculate end time based on the meeting duration preference
                    const endTime = new Date(now.getTime() + meetingDuration * 60 * 1000);
                    // Return a simulated slot for this nanoid
                    slot = {
                        id: id,
                        userId: null,
                        start: startTime,
                        end: endTime,
                        confirmed: false,
                        attendeeEmail: null,
                        attendeeName: null,
                        eventTitle: "Meeting from Email",
                        isSimulated: true, // Flag to indicate this is a simulated slot
                        linkId: id, // Store the linkId for use in confirmation
                    };
                }
            }
        }
        if (!slot) {
            return res.status(404).json({ error: "Slot not found" });
        }
        // Get owner info and timezone preference
        let timezone = "UTC";
        let verifiedCalendarStatus = slot.confirmed;
        let userWithTokens = null;
        if (slot.userId) {
            try {
                // Get user preferences
                const [userPrefs] = await db_1.db
                    .select()
                    .from(schema_1.preferences)
                    .where((0, drizzle_orm_1.eq)(schema_1.preferences.userId, slot.userId));
                // Try to get timezone from user if preferences don't have it
                if (userPrefs) {
                    // Fallback plan - user might have timezone directly set
                    const [userData] = await db_1.db
                        .select()
                        .from(schema_1.users)
                        .where((0, drizzle_orm_1.eq)(schema_1.users.id, slot.userId));
                    if (userData && userData.timezone) {
                        timezone = userData.timezone;
                    }
                    // Save user data for Google Calendar check
                    userWithTokens = userData;
                }
            }
            catch (err) {
                console.warn("Error getting timezone info:", err);
                // Continue with UTC as default
            }
            // Check if slot is confirmed and has an eventId
            if (slot.confirmed && slot.eventId) {
                console.log("Checking calendar status for confirmed slot:", {
                    slotId: slot.id,
                    simulatedId: id !== slot.id ? id : null,
                    eventId: slot.eventId,
                    hasUserTokens: !!(userWithTokens === null || userWithTokens === void 0 ? void 0 : userWithTokens.accessToken),
                });
                try {
                    // Only proceed with calendar check if we have user access token
                    if (userWithTokens && userWithTokens.accessToken) {
                        // Verify if the Google Calendar event still exists
                        // Convert userData to proper AuthenticatedUser format
                        const userForAuth = {
                            id: userWithTokens.id,
                            email: userWithTokens.email,
                            googleId: userWithTokens.googleId,
                            accessToken: userWithTokens.accessToken, // We've already checked it exists above
                            refreshToken: userWithTokens.refreshToken || null,
                            timezone: userWithTokens.timezone || null,
                        };
                        const auth = (0, google_calendar_utils_1.createGoogleClient)(userForAuth);
                        try {
                            console.log(`Checking Google Calendar for event: ${slot.eventId}`);
                            // Try to get the event from Google Calendar
                            const eventResponse = await calendar.events.get({
                                auth,
                                calendarId: "primary",
                                eventId: slot.eventId,
                            });
                            console.log(`Calendar event status for ${slot.eventId}:`, eventResponse.data.status);
                            // Check if the event has been cancelled or deleted
                            if (eventResponse.data.status === "cancelled") {
                                console.log(`Event ${slot.eventId} for slot ${slot.id} has been cancelled`);
                                verifiedCalendarStatus = false;
                                // Update the slot in the database
                                await db_1.db
                                    .update(schema_1.slots)
                                    .set({
                                    confirmed: false,
                                    calendarCreated: false,
                                    attendeeEmail: null,
                                    attendeeName: null,
                                })
                                    .where((0, drizzle_orm_1.eq)(schema_1.slots.id, slot.id));
                                // Update the slot object for the response
                                slot.confirmed = false;
                                slot.calendarCreated = false;
                                slot.attendeeEmail = null;
                                slot.attendeeName = null;
                            }
                        }
                        catch (calendarError) {
                            // If we get a 404 Not Found or any error related to the event not existing
                            console.log("Calendar API error:", ((_a = calendarError === null || calendarError === void 0 ? void 0 : calendarError.response) === null || _a === void 0 ? void 0 : _a.status) ||
                                calendarError.code ||
                                calendarError.message);
                            if (calendarError.code === 404 ||
                                (calendarError.response &&
                                    calendarError.response.status === 404) ||
                                ((_b = calendarError.message) === null || _b === void 0 ? void 0 : _b.includes("Not Found"))) {
                                console.log(`Event ${slot.eventId} for slot ${slot.id} no longer exists in Google Calendar`);
                                verifiedCalendarStatus = false;
                                // Update the slot in the database
                                await db_1.db
                                    .update(schema_1.slots)
                                    .set({
                                    confirmed: false,
                                    calendarCreated: false,
                                    attendeeEmail: null,
                                    attendeeName: null,
                                })
                                    .where((0, drizzle_orm_1.eq)(schema_1.slots.id, slot.id));
                                // Update the slot object for the response
                                slot.confirmed = false;
                                slot.calendarCreated = false;
                                slot.attendeeEmail = null;
                                slot.attendeeName = null;
                            }
                            else {
                                // Log other errors but don't change slot status
                                console.error(`Error checking calendar event status for slot ${slot.id}:`, calendarError);
                            }
                        }
                    }
                    else {
                        console.log(`Skipping Google Calendar check for slot ${slot.id} - no valid user tokens available`);
                    }
                }
                catch (err) {
                    console.warn(`Error verifying Google Calendar event for slot ${slot.id}:`, err);
                    // Continue with current status if verification fails
                }
            }
            else {
                console.log(`Slot ${slot.id} is not eligible for calendar verification:`, {
                    confirmed: slot.confirmed,
                    hasEventId: !!slot.eventId,
                });
            }
        }
        // Return slot details, avoiding exposure of sensitive data
        // For autonomous links (based on URL pattern) or any unconfirmed slot, use a generic title
        // This is the comprehensive fix to prevent any previous meeting titles from showing
        const isAutonomousLink = id.match(/^u\d+-\d{8}-\d{4}$/) || id.match(/^\d{8}-\d{4}$/);
        const shouldShowEventTitle = slot.confirmed && !isAutonomousLink;
        res.json({
            id: slot.id,
            start: slot.start,
            end: slot.end,
            confirmed: slot.confirmed, // This now reflects the verified status
            timezone: timezone,
            // Only show actual event title for confirmed slots and non-autonomous links
            eventTitle: shouldShowEventTitle ? slot.eventTitle : "Schedule Meeting",
            // Only return attendee info if the slot is confirmed AND not for autonomous links
            attendeeEmail: slot.confirmed && !isAutonomousLink ? slot.attendeeEmail : null,
            attendeeName: slot.confirmed && !isAutonomousLink ? slot.attendeeName : null,
            isSimulated: slot.isSimulated || false,
            linkId: slot.linkId || null, // Include linkId for nanoid-based slots if available
        });
    }
    catch (error) {
        console.error("Error fetching slot details:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({
            error: "Failed to fetch slot details",
            details: errorMessage,
        });
    }
};
/**
 * Handler for testing time preferences
 * @param req Express request
 * @param res Express response
 */
/**
 * Test handler for both time preference and working hours filtering
 * Can test either time preference (AM/PM) or working hours, or both
 * @param req Express request with test parameters
 * @param res Express response with filtered results
 */
const handleTimePreferencesTest = async (req, res) => {
    const { preference, timeSlots, slots, workingHoursStart, workingHoursEnd, timezone, verbose, } = req.body;
    // Test pipeline for working hours with timezone
    if (slots && workingHoursStart && workingHoursEnd) {
        console.log(`[TEST] Testing working hours filter in timezone: ${timezone || "UTC"}`);
        console.log(`[TEST] Working hours: ${workingHoursStart} - ${workingHoursEnd}`);
        console.log(`[TEST] Input slots: ${slots.length}`);
        try {
            // Apply the working hours filter with timezone
            const filteredSlots = filterByWorkingHours(slots, workingHoursStart, workingHoursEnd, timezone);
            console.log(`[TEST] Filtered slots: ${filteredSlots.length}`);
            // Add debug information for each slot if verbose mode is enabled
            let slotDebugInfo = [];
            if (verbose) {
                slotDebugInfo = slots.map((slot) => {
                    // Convert UTC slot time to the specified timezone
                    let localTime;
                    if (timezone) {
                        localTime = moment_timezone_1.default
                            .tz(slot.start, timezone)
                            .format("YYYY-MM-DD HH:mm:ss");
                    }
                    else {
                        localTime = new Date(slot.start).toISOString();
                    }
                    // Check if this slot is within working hours
                    const isWithinWorkingHours = filteredSlots.some((fs) => fs.start === slot.start && fs.end === slot.end);
                    return {
                        utcTime: slot.start,
                        localTime,
                        timezone: timezone || "UTC",
                        isWithinWorkingHours,
                    };
                });
            }
            return res.json({
                success: true,
                workingHours: {
                    start: workingHoursStart,
                    end: workingHoursEnd,
                },
                timezone: timezone || "UTC",
                totalSlots: slots.length,
                filteredSlots,
                slotDebugInfo: verbose ? slotDebugInfo : undefined,
            });
        }
        catch (error) {
            console.error("[TEST] Error testing working hours filter:", error);
            return res.status(500).json({
                error: "Error testing working hours filter",
                message: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }
    // Original time preference testing code
    if (!preference) {
        return res
            .status(400)
            .json({ error: "Preference is required for time preference testing" });
    }
    if (!timeSlots || !Array.isArray(timeSlots)) {
        return res.status(400).json({
            error: "Time slots array is required for time preference testing",
        });
    }
    try {
        const allTimes = timeSlots.map((time) => {
            const isAM = time.slice(-2) === "am" ||
                (time.includes(":") &&
                    parseInt(time.split(":")[0]) < 12 &&
                    !time.includes("pm"));
            // Function to check if a time meets the preference criteria
            const meetsPreference = (timeStr, pref) => {
                const isAM = timeStr.slice(-2) === "am" ||
                    (timeStr.includes(":") &&
                        parseInt(timeStr.split(":")[0]) < 12 &&
                        !timeStr.includes("pm"));
                if (pref === "am")
                    return isAM;
                if (pref === "pm")
                    return !isAM;
                return true; // For "any" preference
            };
            return {
                time,
                label: time,
                isAM,
                meetsPreference: meetsPreference(time, preference),
            };
        });
        // Filter times based on preference
        const filteredTimes = allTimes.filter((t) => t.meetsPreference);
        let explanation = "";
        if (preference === "am") {
            explanation = "Showing only morning (AM) time slots.";
        }
        else if (preference === "pm") {
            explanation = "Showing only afternoon/evening (PM) time slots.";
        }
        else {
            explanation =
                "Showing all time slots as no specific time of day preference is set.";
        }
        res.json({
            preference,
            allTimes,
            filteredTimes,
            explanation,
        });
    }
    catch (error) {
        console.error("Error testing time preferences:", error);
        res.status(500).json({
            error: "Error testing time preferences",
            details: error.message || "Unknown error",
        });
    }
};
function registerExtensionRoutes(app) {
    // Analyze email content - add explicit session middleware with authentication requirement
    app.post("/api/calendar/analyze-email", (req, res, next) => {
        var _a;
        // Log the session info before the handler
        console.log("Pre-handler session check:", {
            path: req.path,
            sessionID: req.sessionID,
            hasSession: !!req.session,
            isAuthenticated: ((_a = req.isAuthenticated) === null || _a === void 0 ? void 0 : _a.call(req)) || false,
            hasUser: !!req.user,
            origin: req.headers.origin,
            cookie: req.headers.cookie ? "Present" : "None",
        });
        // Require authentication for analyze-email
        if (!isUserAuthenticated(req) || !req.user) {
            console.log("User not authenticated for analyze-email endpoint");
            return res.status(401).json({
                success: false,
                error: "Unauthorized",
                message: "Authentication is required to access this feature",
            });
        }
        next();
    }, handleAnalyzeEmail);
    // Create a new slot - requires authentication
    app.post("/api/calendar/slots", (req, res, next) => {
        // Require authentication for creating slots
        if (!isUserAuthenticated(req) || !req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }
        next();
    }, handleCreateSlot);
    // Confirm a slot (support both GET and POST for backward compatibility)
    // These endpoints are public - no authentication check required
    app.get("/api/calendar/slots/:id/confirm", handleSlotConfirmation);
    app.post("/api/calendar/slots/:id/confirm", handleSlotConfirmation);
    // New URL format for slot confirmation (used by extension)
    // These endpoints are also public - no authentication required
    app.get("/api/calendar/slots/confirm/:id", handleSlotConfirmation);
    app.post("/api/calendar/slots/confirm/:id", handleSlotConfirmation);
    // Get slot details - public endpoint, no authentication required
    app.get("/api/calendar/slots/:id", handleGetSlotDetails);
    // Test time preferences - public endpoint, no authentication required
    app.post("/api/calendar/time-test", handleTimePreferencesTest);
}
