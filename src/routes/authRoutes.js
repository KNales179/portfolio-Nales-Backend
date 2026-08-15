import express from "express";

import {
    setupSuperAdmin,
    login,
    verifyLoginTwoFactor,
    setupTwoFactor,
    enableTwoFactor,
    disableTwoFactor,
    getCurrentAdmin,
    logout,

    // Trusted devices
    getTrustedDevices,
    addTrustedDevice,
    removeTrustedDevice,
} from "../controllers/authController.js";

import { protect } from "../middleware/authMiddleware.js";

import {
    loginRateLimiter,
    twoFactorRateLimiter,
    passwordResetRateLimiter,
} from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

// ============================================================
// INITIAL SUPER ADMIN SETUP
// ============================================================

router.post(
    "/setup-superadmin",
    setupSuperAdmin
);

// ============================================================
// LOGIN
// ============================================================

router.post(
    "/login",
    loginRateLimiter,
    login
);

// ============================================================
// VERIFY 2FA DURING LOGIN
// ============================================================
//
// This route intentionally does NOT use `protect`.
//
// The user does not have a real JWT yet.
// They only have the short-lived 2FA challenge token.
//

router.post(
    "/login/2fa",
    twoFactorRateLimiter,
    verifyLoginTwoFactor
);

// ============================================================
// 2FA SETUP
// ============================================================
//
// These routes require an already authenticated admin.
//

router.post(
    "/2fa/setup",
    protect,
    setupTwoFactor
);

router.post(
    "/2fa/enable",
    protect,
    twoFactorRateLimiter,
    enableTwoFactor
);

router.post(
    "/2fa/disable",
    protect,
    twoFactorRateLimiter,
    disableTwoFactor
);

// ============================================================
// TRUSTED DEVICES
// ============================================================
//
// These routes require an authenticated admin.
//
// GET    /trusted-devices
// POST   /trusted-devices
// DELETE /trusted-devices/:deviceId
//
// The frontend settings page can use these later.
// ============================================================

// GET TRUSTED DEVICES
router.get(
    "/trusted-devices",
    protect,
    getTrustedDevices
);

// MANUALLY ADD TRUSTED DEVICE
router.post(
    "/trusted-devices",
    protect,
    addTrustedDevice
);

// MANUALLY REMOVE TRUSTED DEVICE
router.delete(
    "/trusted-devices/:deviceId",
    protect,
    removeTrustedDevice
);

// ============================================================
// CURRENT ADMIN
// ============================================================

router.get(
    "/me",
    protect,
    getCurrentAdmin
);

// ============================================================
// LOGOUT
// ============================================================

router.post(
    "/logout",
    protect,
    logout
);

export default router;