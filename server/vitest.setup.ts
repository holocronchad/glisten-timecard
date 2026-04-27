// Provide the env vars that src/config.ts requires before any test imports
// kick in. These are fake — pure-function tests never touch the database.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-jwt-secret-not-used-in-real-flows-32chars';
process.env.NODE_ENV ||= 'test';
