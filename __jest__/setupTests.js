// This file will be run before each test file
// It silences console output during tests to keep the output clean

// Store original console methods
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Replace console methods with empty functions to suppress output
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

// Restore original console methods after tests complete
afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
}); 