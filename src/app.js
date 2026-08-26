import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import heroRoutes from "./routes/heroRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import workRoutes from "./routes/workRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";

const app = express();

app.set("trust proxy", true);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Portfolio API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/hero", heroRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/work", workRoutes);
app.use("/api/contact", contactRoutes);

export default app;