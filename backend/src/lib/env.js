import dotenv from "dotenv";

dotenv.config({ quiet: true });

console.log(process.env.PORT);

export const ENV = {
  PORT: process.env.PORT,
  DB_URL: process.env.DB_URL,
  CLIENT_URL: process.env.CLIENT_URL,
  INGEST_API_KEY: process.env.INGEST_API_KEY,
  STREAM_API_KEY: process.env.STREAM_API_KEY,
  STREAM_API_SECRET: process.env.STREAM_API_SECRET,
  CLERK_PUBLISHIABLE_KEY: process.env.CLERK_PUBLISHIABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
};

export default ENV;
