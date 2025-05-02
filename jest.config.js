/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Silence console output during tests
  silent: false,
  verbose: false,
  // Setup file to silence specific console methods
  setupFilesAfterEnv: ['../__jest__/setupTests.js'],
}; 