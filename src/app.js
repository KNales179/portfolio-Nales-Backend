import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import heroRoutes from "./routes/heroRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import workRoutes from "./routes/workRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import contentRoutes from "./routes/contentRoutes.js";

const app = express();

// ============================================================
// PROXY
// ============================================================
//
// Render (and most hosts) put exactly one proxy in front of the
// app. Trusting a fixed hop count means `req.ip` is the real
// client address and X-Forwarded-For cannot be spoofed past it
// — which matters because rate limiting and audit logs key on
// `req.ip`.
//
// Override with TRUST_PROXY if a different setup is used.
// ============================================================

const trustProxy = process.env.TRUST_PROXY;

app.set(
  "trust proxy",
  trustProxy === undefined
    ? 1
    : /^\d+$/.test(trustProxy)
    ? Number(trustProxy)
    : trustProxy === "true"
);

// ============================================================
// SECURITY HEADERS
// ============================================================

app.use(helmet());

// ============================================================
// CORS
// ============================================================
//
// Only the portfolio frontend(s) may call the API with
// credentials. Set ALLOWED_ORIGINS to a comma-separated list.
// ============================================================

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (curl, server-to-server) send no Origin.
      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("Origin not allowed by CORS")
      );
    },
    credentials: true,
  })
);

// ============================================================
// BODY PARSING
// ============================================================

app.use(express.json({ limit: "64kb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "64kb",
  })
);

// ============================================================
// HEALTH
// ============================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Portfolio API is running",
  });
});

// ============================================================
// ROUTES
// ============================================================

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/hero", heroRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/work", workRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/content", contentRoutes);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
//
// Catches thrown errors (including body-parser 413s and the
// CORS rejection above) so the process never leaks a stack
// trace to the client.
// ============================================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error("Unhandled error:", err.message);
  }

  res.status(status).json({
    success: false,
    message:
      status === 413
        ? "Request payload too large."
        : status < 500
        ? err.message || "Request failed."
        : "Internal server error.",
  });
});

export default app;
