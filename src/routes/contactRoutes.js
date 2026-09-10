import express from "express";

import {
  sendContactMessage,
  listMessages,
  unreadCount,
  setMessageStatus,
  archiveMessage,
  restoreMessage,
  deleteMessage,
} from "../controllers/contactController.js";

import { protect } from "../middleware/authMiddleware.js";
import { contactRateLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();


// ============================================================
// PUBLIC
// ============================================================

router.post("/", contactRateLimiter, sendContactMessage);


// ============================================================
// ADMIN — INBOX
// ============================================================
//
// Specific paths before "/:id" so they aren't swallowed by it.
// ============================================================

router.get("/messages", protect, listMessages);

router.get(
  "/messages/unread-count",
  protect,
  unreadCount
);

router.patch(
  "/messages/:id",
  protect,
  setMessageStatus
);

router.post(
  "/messages/:id/archive",
  protect,
  archiveMessage
);

router.post(
  "/messages/:id/restore",
  protect,
  restoreMessage
);

router.delete(
  "/messages/:id",
  protect,
  deleteMessage
);


export default router;
