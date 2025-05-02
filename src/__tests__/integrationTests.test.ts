import moment from "moment-timezone";
import {
  convertExtractedTimesToUserTimezone,
  processEmailAnalysisWithTimezones,
} from "../timezone-conversion-service";

// Test dates for different seasons
const summerDate = "2025-05-06"; // May 6, 2025 (summer - both regions in DST)
const winterDate = "2025-01-15"; // Jan 15, 2025 (winter - both regions in standard time)

describe("Integration Tests", () => {
  describe("Email Extraction Pipeline", () => {
    // Mock data simulating an email with 9 AM ET
    const mockExtractedData = {
      dates: [
        {
          date: summerDate,
          weekday: "Tuesday",
          times: [
            {
              start: "09:00",
              end: "09:30",
              isSpecificTime: true,
              isTimeRange: false,
              isAllDay: false,
              sourceTimezone: "ET",
            },
          ],
        },
      ],
      event_title: "Test Meeting",
      meeting_duration: 30,
    };

    test("should convert times in the extracted data to user timezone", () => {
      const userTimezone = "Europe/Kyiv";
      const convertedData = convertExtractedTimesToUserTimezone(
        mockExtractedData,
        userTimezone
      );

      // Verify the data structure
      expect(convertedData.dates[0].times[0]).toHaveProperty("convertedStart");
      expect(convertedData.dates[0].times[0].convertedStart).toBe("16:00");

      // Original values should be preserved
      expect(convertedData.dates[0].times[0].originalStart).toBe("09:00");
      expect(convertedData.dates[0].times[0].originalEnd).toBe("09:30");

      // Source timezone should be preserved
      expect(convertedData.dates[0].times[0].sourceTimezone).toBe("ET");
    });

    test("should process email data and generate correct candidate slots", () => {
      const userTimezone = "Europe/Kyiv";
      const processedData = processEmailAnalysisWithTimezones(
        mockExtractedData,
        userTimezone
      );

      // Check that we have candidate slots
      expect(processedData.candidateSlots.length).toBeGreaterThan(0);

      const slot = processedData.candidateSlots[0];

      // Verify slot times
      expect(slot.startLocal).toBe(`${summerDate}T16:00:00`);
      expect(slot.endLocal).toBe(`${summerDate}T16:30:00`);

      // Verify timezone info
      expect(slot.sourceTimezone).toBe("ET");
      expect(slot.sourceTime).toBe("EDT");
      expect(slot.localTimezone).toBe("Europe/Kyiv");
      expect(slot.localTime).toBe("EEST");

      // Verify original source times
      expect(slot.originalStart).toBe("09:00");
      expect(slot.originalEnd).toBe("09:30");
    });
  });

  describe("Bug Fix Verification: 9 AM ET to 4 PM EEST", () => {
    // Simulate data for the specific bug case
    const bugTestData = {
      dates: [
        {
          date: summerDate,
          weekday: "Tuesday",
          times: [
            {
              start: "09:00",
              end: "10:00",
              isSpecificTime: true,
              isTimeRange: false,
              isAllDay: false,
              sourceTimezone: "ET",
            },
          ],
        },
      ],
      event_title: "Verify Bug Fix",
      meeting_duration: 60,
    };

    test("should convert 9 AM ET to 4 PM EEST (not 5 PM)", () => {
      const userTimezone = "Europe/Kyiv";
      const bugFixResult = processEmailAnalysisWithTimezones(
        bugTestData,
        userTimezone
      );

      // Check that we have candidate slots
      expect(bugFixResult.candidateSlots.length).toBeGreaterThan(0);

      const slot = bugFixResult.candidateSlots[0];

      // The critical test for the bug fix - should be 16:00 (4 PM), not 17:00 (5 PM)
      const localTimeHour = moment(slot.startLocal).format("HH");
      expect(localTimeHour).toBe("16");

      // Verify the full date format
      expect(slot.startLocal).toBe(`${summerDate}T16:00:00`);

      // Verify source time is correctly preserved
      expect(slot.startSource).toContain("09:00");
      expect(slot.sourceTime).toBe("EDT");

      // Calculate hour difference (should be 7 hours)
      const hourDifference =
        moment.tz(slot.startLocal, "Europe/Kyiv").hour() -
        moment.tz(slot.startSource, "America/New_York").hour();
      expect(hourDifference).toBe(7);
    });
  });

  describe("Additional Timezone Combinations", () => {
    test("should convert Pacific Time (PT) to Japan Standard Time (JST)", () => {
      // Create mock data with PT timezone
      const ptToJstData = {
        dates: [
          {
            date: summerDate,
            weekday: "Tuesday",
            times: [
              {
                start: "14:00",
                end: "15:00",
                isSpecificTime: true,
                isTimeRange: false,
                isAllDay: false,
                sourceTimezone: "PT",
              },
            ],
          },
        ],
        event_title: "PT to JST Test",
        meeting_duration: 60,
      };

      const result = processEmailAnalysisWithTimezones(
        ptToJstData,
        "Asia/Tokyo"
      );

      expect(result.candidateSlots.length).toBeGreaterThan(0);

      const slot = result.candidateSlots[0];

      // 2 PM PT should be around 6-7 AM JST next day (+16/17 hours)
      const localTimeHour = moment(slot.startLocal).hour();
      // Allow 6 or 7 AM depending on DST
      expect(localTimeHour === 6 || localTimeHour === 7).toBeTruthy();

      // Check source/target timezones
      expect(slot.sourceTimezone).toBe("PT");
      expect(slot.sourceTime).toBe("PDT"); // Summer date should be PDT
      expect(slot.localTimezone).toBe("Asia/Tokyo");
      expect(slot.localTime).toBe("JST");
    });

    test("should convert Central European Time (CET) to Indian Standard Time (IST)", () => {
      const cetToIstData = {
        dates: [
          {
            date: summerDate,
            weekday: "Tuesday",
            times: [
              {
                start: "10:00",
                end: "11:00",
                isSpecificTime: true,
                isTimeRange: false,
                isAllDay: false,
                sourceTimezone: "CET",
              },
            ],
          },
        ],
        event_title: "CET to IST Test",
        meeting_duration: 60,
      };

      const result = processEmailAnalysisWithTimezones(
        cetToIstData,
        "Asia/Kolkata"
      );

      expect(result.candidateSlots.length).toBeGreaterThan(0);

      const slot = result.candidateSlots[0];

      // Check time conversion from CET to IST (+3.5/4.5 hours)
      const localTimeHours = moment(slot.startLocal).format("HH:mm");
      expect(["13:30", "14:30"].includes(localTimeHours)).toBeTruthy();
    });
  });
});
