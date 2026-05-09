import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use service-role / direct connection for schema generation — never the pooled anon URL.
    url:
      process.env.DATABASE_URL_ADMIN ??
      process.env.DATABASE_URL_DIRECT ??
      process.env.DATABASE_URL ??
      '',
  },
  verbose: true,
  strict: true,
});
