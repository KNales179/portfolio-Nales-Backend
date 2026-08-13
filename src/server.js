import dotenv from "dotenv";

dotenv.config();

import { v2 as cloudinary } from "cloudinary";
import app from "./app.js";
import connectDB from "./config/database.js";

// ============================================================
// CLOUDINARY CONFIGURATION
// ============================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Make Cloudinary available to controllers through Express
app.locals.cloudinary = cloudinary;

// ============================================================
// ENVIRONMENT CHECK
// ============================================================

console.log("Environment check:", {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME
        ? "LOADED"
        : "MISSING",

    api_key: process.env.CLOUDINARY_API_KEY
        ? "LOADED"
        : "MISSING",

    api_secret: process.env.CLOUDINARY_API_SECRET
        ? "LOADED"
        : "MISSING",
});

// ============================================================
// SERVER
// ============================================================

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB();

        app.listen(PORT, () => {
            console.log(
                `Server running on http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error(
            "Server startup failed:",
            error.message
        );

        process.exit(1);
    }
};

startServer();