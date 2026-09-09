import express from "express";

import {
    collectEvents,
    getPageAnalytics,
    getInteractionAnalytics,
    getAudienceAnalytics,
    getVisitors,
    getVisitorDetail,
    getVisitorFlow,
    getEngagementAnalytics,
    getPublicAnalytics,
} from "../controllers/analyticsController.js";

import { protect } from "../middleware/authMiddleware.js";
import {
    analyticsCollectRateLimiter,
    publicAnalyticsRateLimiter,
} from "../middleware/rateLimitMiddleware.js";

const router = express.Router();


// ============================================================
// PUBLIC — EVENT INGESTION
// ============================================================

router.post(
    "/collect",
    analyticsCollectRateLimiter,
    collectEvents
);

router.get(
    "/public",
    publicAnalyticsRateLimiter,
    getPublicAnalytics
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

router.get(
    "/visitors",
    protect,
    getVisitors
);

router.get(
    "/visitors/:visitorHash",
    protect,
    getVisitorDetail
);

router.get(
    "/flow",
    protect,
    getVisitorFlow
);

router.get(
    "/engagement",
    protect,
    getEngagementAnalytics
);


export default router;
