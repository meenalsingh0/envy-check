// Fixture: every supported access pattern. Line numbers matter to the tests —
// update extractor.test.ts if you edit this file.
const apiKey = process.env.API_KEY;
const dbUrl = process.env['DATABASE_URL'];
const secret = process.env[`SESSION_SECRET`];
const { PORT, NODE_ENV: mode } = process.env;

const viteUrl = import.meta.env.VITE_API_URL;
const { VITE_FLAG } = import.meta.env;

// Dynamic access — must NOT be reported:
const key = 'HOME';
const dynamic = process.env[key];

export { apiKey, dbUrl, secret, PORT, mode, viteUrl, VITE_FLAG, dynamic };
