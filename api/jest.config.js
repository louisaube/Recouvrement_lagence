// Unit and integration tests: the files tests/*.test.ts of each feature, run against the running test API (port 4000).
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: false }] },
  testTimeout: 30000,
}
