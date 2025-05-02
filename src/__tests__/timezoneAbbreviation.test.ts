import { getTimezoneAbbreviation } from "../timezone-conversion-service";
import { convertTimezoneAbbreviation } from "../timezone-utils";
import moment from "moment-timezone";

// Test dates
const summerDate = "2025-05-06"; // May 6, 2025 (summer - both regions in DST)
const winterDate = "2025-01-15"; // Jan 15, 2025 (winter - both regions in standard time)

describe("Timezone Abbreviation Tests", () => {
  describe("Timezone abbreviation mapping", () => {
    test("should map ET to America/New_York", () => {
      const result = convertTimezoneAbbreviation("ET");
      expect(result).toBe("America/New_York");
    });

    test("should map EDT to America/New_York", () => {
      const result = convertTimezoneAbbreviation("EDT");
      expect(result).toBe("America/New_York");
    });

    test("should map EST to America/New_York", () => {
      const result = convertTimezoneAbbreviation("EST");
      expect(result).toBe("America/New_York");
    });

    test("should map EEST to Europe/Kiev", () => {
      const result = convertTimezoneAbbreviation("EEST");
      expect(result).toBe("Europe/Kiev");
    });

    test("should map EET to Europe/Kiev", () => {
      const result = convertTimezoneAbbreviation("EET");
      expect(result).toBe("Europe/Kiev");
    });
  });

  describe("getTimezoneAbbreviation with date parameter", () => {
    test("should return EDT for America/New_York in summer", () => {
      const result = getTimezoneAbbreviation("America/New_York", summerDate);
      expect(result).toBe("EDT");

      // Verify with moment directly
      const momentResult = moment
        .tz(`${summerDate}T12:00:00`, "America/New_York")
        .format("z");
      expect(result).toBe(momentResult);

      // Check DST status
      const isDst = moment
        .tz(`${summerDate}T12:00:00`, "America/New_York")
        .isDST();
      expect(isDst).toBe(true);
    });

    test("should return EST for America/New_York in winter", () => {
      const result = getTimezoneAbbreviation("America/New_York", winterDate);
      expect(result).toBe("EST");

      // Verify with moment directly
      const momentResult = moment
        .tz(`${winterDate}T12:00:00`, "America/New_York")
        .format("z");
      expect(result).toBe(momentResult);

      // Check DST status
      const isDst = moment
        .tz(`${winterDate}T12:00:00`, "America/New_York")
        .isDST();
      expect(isDst).toBe(false);
    });

    test("should return EEST for Europe/Kyiv in summer", () => {
      const result = getTimezoneAbbreviation("Europe/Kyiv", summerDate);
      expect(result).toBe("EEST");

      // Verify with moment directly
      const momentResult = moment
        .tz(`${summerDate}T12:00:00`, "Europe/Kyiv")
        .format("z");
      expect(result).toBe(momentResult);

      // Check DST status
      const isDst = moment.tz(`${summerDate}T12:00:00`, "Europe/Kyiv").isDST();
      expect(isDst).toBe(true);
    });

    test("should return EET for Europe/Kyiv in winter", () => {
      const result = getTimezoneAbbreviation("Europe/Kyiv", winterDate);
      expect(result).toBe("EET");

      // Verify with moment directly
      const momentResult = moment
        .tz(`${winterDate}T12:00:00`, "Europe/Kyiv")
        .format("z");
      expect(result).toBe(momentResult);

      // Check DST status
      const isDst = moment.tz(`${winterDate}T12:00:00`, "Europe/Kyiv").isDST();
      expect(isDst).toBe(false);
    });

    test("should return JST for Asia/Tokyo (no DST)", () => {
      const result = getTimezoneAbbreviation("Asia/Tokyo", summerDate);
      expect(result).toBe("JST");

      // Japan doesn't use DST
      const isDst = moment.tz(`${summerDate}T12:00:00`, "Asia/Tokyo").isDST();
      expect(isDst).toBe(false);
    });

    test("should return UTC for invalid timezone", () => {
      const result = getTimezoneAbbreviation("Invalid/Timezone", summerDate);
      expect(result).toBe("UTC");
    });

    test("should return UTC for empty timezone", () => {
      const result = getTimezoneAbbreviation("", summerDate);
      expect(result).toBe("UTC");
    });
  });
});
