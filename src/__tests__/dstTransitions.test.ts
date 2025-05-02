import {
  convertTimezoneSafe,
  getTimezoneAbbreviation,
} from "../timezone-conversion-service";

/**
 * These tests verify proper handling of DST transitions and special timezone cases
 */

describe("DST Transitions and Special Timezone Cases", () => {
  describe("DST transition edge cases", () => {
    test("Converting time during US spring forward (March)", () => {
      // March 8, 2026 is DST transition in US
      const result = convertTimezoneSafe(
        "2026-03-08",
        "01:30", // 1:30 AM, before the transition
        "America/New_York",
        "Europe/Paris"
      );

      expect(result.convertedTime).toBe("07:30");
      expect(result.sourceOffset).toBe(-5); // EST is UTC-5
      expect(result.targetOffset).toBe(1); // CET is UTC+1
    });

    test("Converting time after US spring forward (March)", () => {
      // March 8, 2026 is DST transition in US
      const result = convertTimezoneSafe(
        "2026-03-08",
        "03:30", // 3:30 AM, after the transition
        "America/New_York",
        "Europe/Paris"
      );

      expect(result.convertedTime).toBe("08:30");
      expect(result.sourceOffset).toBe(-4); // EDT is UTC-4
      expect(result.targetOffset).toBe(1); // CET is UTC+1
    });

    test("Converting time during EU fall back (October)", () => {
      // October 25, 2026 is DST transition in EU
      const result = convertTimezoneSafe(
        "2026-10-25",
        "14:00", // 2 PM, after the transition
        "Europe/Paris",
        "America/New_York"
      );

      expect(result.convertedTime).toBe("09:00");
      expect(result.sourceOffset).toBe(1); // CET is UTC+1 (after falling back)
      expect(result.targetOffset).toBe(-4); // EDT is UTC-4
    });
  });

  describe("Unusual timezone offsets", () => {
    test("Nepal (UTC+5:45) to standard timezone", () => {
      const result = convertTimezoneSafe(
        "2025-07-15",
        "12:00",
        "Asia/Kathmandu", // UTC+5:45
        "Europe/London" // UTC+1 in summer
      );

      expect(result.convertedTime).toBe("07:15");
      expect(result.sourceOffset).toBe(5.75); // Nepal is UTC+5:45 (5.75 hours)
      expect(result.targetOffset).toBe(1); // BST is UTC+1
    });

    test("Chatham Islands (UTC+12:45) to standard timezone", () => {
      const result = convertTimezoneSafe(
        "2025-01-15", // Southern hemisphere summer
        "15:00",
        "Pacific/Chatham", // UTC+13:45 in summer
        "America/New_York" // UTC-5 in winter
      );

      expect(result.convertedTime).toBe("20:15");
      // Time crosses day boundary but we check via hour difference
      expect(result.hourDifference).toBeLessThan(-12);
    });
  });

  describe("Date-specific timezone abbreviations", () => {
    test("America/New_York abbreviation changes with date", () => {
      // Summer - should be EDT
      const summerAbbr = getTimezoneAbbreviation(
        "America/New_York",
        "2025-07-15"
      );
      expect(summerAbbr).toBe("EDT");

      // Winter - should be EST
      const winterAbbr = getTimezoneAbbreviation(
        "America/New_York",
        "2025-01-15"
      );
      expect(winterAbbr).toBe("EST");
    });

    test("Europe/Kyiv abbreviation changes with date", () => {
      // Summer - should be EEST
      const summerAbbr = getTimezoneAbbreviation("Europe/Kyiv", "2025-07-15");
      expect(summerAbbr).toBe("EEST");

      // Winter - should be EET
      const winterAbbr = getTimezoneAbbreviation("Europe/Kyiv", "2025-01-15");
      expect(winterAbbr).toBe("EET");
    });

    test("Non-DST timezone keeps same abbreviation", () => {
      // Phoenix doesn't observe DST
      const summerAbbr = getTimezoneAbbreviation(
        "America/Phoenix",
        "2025-07-15"
      );
      const winterAbbr = getTimezoneAbbreviation(
        "America/Phoenix",
        "2025-01-15"
      );

      expect(summerAbbr).toBe(winterAbbr);
      expect(summerAbbr).toBe("MST");
    });
  });

  describe("Timezone abbreviation around DST transitions", () => {
    test("Abbreviation changes during spring forward", () => {
      // March 8, 2026 is DST transition in US
      const beforeTransitionAbbr = getTimezoneAbbreviation(
        "America/New_York",
        "2026-03-08T01:30:00"
      );
      const afterTransitionAbbr = getTimezoneAbbreviation(
        "America/New_York",
        "2026-03-08T03:30:00"
      );

      expect(beforeTransitionAbbr).toBe("EST");
      expect(afterTransitionAbbr).toBe("EDT");
    });

    test("Abbreviation changes during fall back", () => {
      // November 1, 2026 is DST transition in US
      const beforeTransitionAbbr = getTimezoneAbbreviation(
        "America/New_York",
        "2026-11-01T00:30:00"
      );
      const afterTransitionAbbr = getTimezoneAbbreviation(
        "America/New_York",
        "2026-11-01T02:30:00"
      );

      expect(beforeTransitionAbbr).toBe("EDT");
      expect(afterTransitionAbbr).toBe("EST");
    });
  });
});
