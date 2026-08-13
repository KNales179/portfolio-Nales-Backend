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
} from "../controllers/authController.js";

import { protect } from "../middleware/authMiddleware.js";

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
    enableTwoFactor
);

router.post(
    "/2fa/disable",
    protect,
    disableTwoFactor
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