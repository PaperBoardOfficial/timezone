"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const timezone_conversion_service_1 = require("../timezone-conversion-service");
// Test dates
const summerDate = "2025-05-06"; // May 6, 2025 (summer - both regions in DST)
const winterDate = "2025-01-15"; // Jan 15, 2025 (winter - both regions in standard time)
const springDate = "2025-03-15"; // Mar 15, 2025 (spring - US still in EST, Europe in EEST)
const fallDate = "2025-11-05"; // Nov 5, 2025 (fall - US in EST, Europe in EET)
describe("Timezone Conversion Tests", () => {
    describe("ET to EEST conversion across seasons", () => {
        test("should convert 9 AM ET to 4 PM EEST in summer (both in DST)", () => {
            const result = (0, timezone_conversion_service_1.convertTimezoneSafe)(summerDate, "09:00", "ET", "Europe/Kyiv");
            expect(result.convertedTime).toBe("16:00");
            expect(result.sourceTimezone).toBe("America/New_York");
            expect(result.targetTimezone).toBe("Europe/Kyiv");
            expect(result.sourceOffset).toBe(-4);
            expect(result.targetOffset).toBe(3);
            expect(result.hourDifference).toBe(7);
            expect(result.sourceFormatted).toBe("9:00 AM");
            expect(result.targetFormatted).toBe("4:00 PM");
        });
        test("should convert 9 AM ET to 4 PM EET in winter (both in standard time)", () => {
            const result = (0, timezone_conversion_service_1.convertTimezoneSafe)(winterDate, "09:00", "ET", "Europe/Kyiv");
            expect(result.convertedTime).toBe("16:00");
            expect(result.sourceTimezone).toBe("America/New_York");
            expect(result.targetTimezone).toBe("Europe/Kyiv");
            expect(result.sourceOffset).toBe(-5);
            expect(result.targetOffset).toBe(2);
            expect(result.hourDifference).toBe(7);
            expect(result.sourceFormatted).toBe("9:00 AM");
            expect(result.targetFormatted).toBe("4:00 PM");
        });
        test("should convert 9 AM ET to 3 PM EET in spring (mixed DST states)", () => {
            const result = (0, timezone_conversion_service_1.convertTimezoneSafe)(springDate, "09:00", "ET", "Europe/Kyiv");
            expect(result.convertedTime).toBe("15:00");
            expect(result.sourceTimezone).toBe("America/New_York");
            expect(result.targetTimezone).toBe("Europe/Kyiv");
            expect(result.sourceOffset).toBe(-4);
            expect(result.targetOffset).toBe(2);
            expect(result.hourDifference).toBe(6);
            expect(result.sourceFormatted).toBe("9:00 AM");
            expect(result.targetFormatted).toBe("3:00 PM");
        });
        test("should convert 9 AM ET to 4 PM EET in fall (mixed DST states)", () => {
            const result = (0, timezone_conversion_service_1.convertTimezoneSafe)(fallDate, "09:00", "ET", "Europe/Kyiv");
            expect(result.convertedTime).toBe("16:00");
            expect(result.sourceTimezone).toBe("America/New_York");
            expect(result.targetTimezone).toBe("Europe/Kyiv");
            expect(result.sourceOffset).toBe(-5);
            expect(result.targetOffset).toBe(2);
            expect(result.hourDifference).toBe(7);
            expect(result.sourceFormatted).toBe("9:00 AM");
            expect(result.targetFormatted).toBe("4:00 PM");
        });
    });
    describe("Error handling", () => {
        test("should handle invalid timezones gracefully", () => {
            const result = (0, timezone_conversion_service_1.convertTimezoneSafe)(summerDate, "09:00", "InvalidTZ", "AnotherInvalidTZ");
            // Should return the input time when conversion fails
            expect(result.convertedTime).toBe("09:00");
            expect(result.sourceTimezone).toBe("InvalidTZ");
            expect(result.targetTimezone).toBe("AnotherInvalidTZ");
        });
    });
});
