process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/project_tracker?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-123';
process.env.PORT = process.env.PORT ?? '4000';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
