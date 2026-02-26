import mongoose from "mongoose";
import { ENV } from "./env.js";

export const connectDB = async () => {
  try {
    const connDB = await mongoose.connect(ENV.DB_URL);
    console.log(`MongoDB Connected: ${connDB.connection.host}`);
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};
