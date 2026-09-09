import express from "express";

import {
    collectEvents,
    getPageAnalytics,
} from "../controllers/analyticsController.js";

import { protect } from "../middleware/authMiddleware.js";
import { analyticsCollectRateLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();


// ============================================================
// PUBLIC — EVENT INGESTION
// ============================================================

router.post(
    "/collect",
    analyticsCollectRateLimiter,
    collectEvents
);


// ============================================================
// ADMIN — REPORTING
// ============================================================

router.get(
    "/pages",
    protect,
    getPageAnalytics
);


export default router;
