import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const connection = await mongoose.connect(
      process.env.MONGODB_URI
    );

    console.log(
      `MongoDB connected successfully: ${connection.connection.name}`
    );
  } catch (error) {
    console.error(
      "MongoDB connection failed:",
      error.message
    );

    throw error;
  }
};

export default connectDB;