module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false, tsconfig: { esModuleInterop: true, target: 'es2022', module: 'commonjs' } }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/e2e/", "/node_modules/"],
  testTimeout: 120000,
}
