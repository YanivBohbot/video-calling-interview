import dotenv from "dotenv";

dotenv.config();

console.log(process.env.PORT);

export const ENV = {
  PORT: process.env.PORT,
  DB_URL: process.env.DB_URL,
};

export default ENV;
