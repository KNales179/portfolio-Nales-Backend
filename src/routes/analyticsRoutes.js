import express from "express";

import {
    collectEvents,
    getPageAnalytics,
    getInteractionAnalytics,
    getAudienceAnalytics,
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

router.get(
    "/interactions",
    protect,
    getInteractionAnalytics
);

router.get(
    "/audience",
    protect,
    getAudienceAnalytics
);


export default router;
