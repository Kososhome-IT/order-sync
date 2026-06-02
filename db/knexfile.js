const config = {
  development: {
    client: "pg",
    connection: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/shopify_netsuite",
    migrations: {
      directory: "./db/migrations",
      extension: "sql",
    },
    pool: { min: 2, max: 10 },
  },
  production: {
    client: "pg",
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    migrations: {
      directory: "./db/migrations",
      extension: "sql",
    },
    pool: { min: 2, max: 20 },
  },
};

export default config;
