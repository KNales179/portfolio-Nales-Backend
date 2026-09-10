import express from "express";

import {
    getMyProfile,
    updateMyProfile,
    changeMyUsername,
    changeMyPassword,
    completeFirstLogin,
    verifyStepUp,
    getAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    updateAdminStatus,
    setAdminPassword,
    deleteAdmin,
    resetPasswordWithTwoFactor,
} from "../controllers/adminController.js";

import { getAuditLogs } from "../controllers/auditController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireStepUp } from "../middleware/stepUpMiddleware.js";
import {
    passwordResetRateLimiter,
    twoFactorRateLimiter,
} from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| CURRENT ADMIN
|--------------------------------------------------------------------------
*/

router.get(
    "/profile",
    protect,
    getMyProfile
);

router.put(
    "/profile",
    protect,
    updateMyProfile
);

router.patch(
    "/profile/username",
    protect,
    changeMyUsername
);

router.patch(
    "/profile/password",
    protect,
    changeMyPassword
);

router.patch(
    "/profile/complete-first-login",
    protect,
    completeFirstLogin
);

/*
|--------------------------------------------------------------------------
| SUPER ADMIN - AUDIT LOG
|--------------------------------------------------------------------------
*/

// Both roles may review the content history; only a super admin
// can widen the scope to auth / admin / work events (enforced in
// the controller).
router.get(
    "/audit-logs",
    protect,
    authorize("ADMIN", "SUPER_ADMIN"),
    getAuditLogs
);

/*
|--------------------------------------------------------------------------
| SUPER ADMIN - ADMIN MANAGEMENT
|
| Reads need only the SUPER_ADMIN role. Every write additionally
| requires a fresh step-up 2FA token (X-Step-Up header) obtained
| from POST /verify-2fa.
|--------------------------------------------------------------------------
*/

router.post(
    "/verify-2fa",
    protect,
    authorize("SUPER_ADMIN"),
    twoFactorRateLimiter,
    verifyStepUp
);

router.get(
    "/",
    protect,
    authorize("SUPER_ADMIN"),
    getAdmins
);

router.get(
    "/:id",
    protect,
    authorize("SUPER_ADMIN"),
    getAdminById
);

router.post(
    "/",
    protect,
    authorize("SUPER_ADMIN"),
    requireStepUp,
    createAdmin
);

router.put(
    "/:id",
    protect,
    authorize("SUPER_ADMIN"),
    requireStepUp,
    updateAdmin
);

router.patch(
    "/:id/status",
    protect,
    authorize("SUPER_ADMIN"),
    requireStepUp,
    updateAdminStatus
);

router.patch(
    "/:id/password",
    protect,
    authorize("SUPER_ADMIN"),
    requireStepUp,
    setAdminPassword
);

router.delete(
    "/:id",
    protect,
    authorize("SUPER_ADMIN"),
    requireStepUp,
    deleteAdmin
);

// ============================================================
// RESET PASSWORD USING 2FA
// ============================================================

router.post(
    "/password/reset-2fa",
    protect,
    passwordResetRateLimiter,
    resetPasswordWithTwoFactor,
);

export default router;