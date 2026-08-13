import express from "express";

import {
    getMyProfile,
    updateMyProfile,
    changeMyUsername,
    changeMyPassword,
    completeFirstLogin,
    getAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    updateAdminStatus,
    deleteAdmin,
    resetPasswordWithTwoFactor,
} from "../controllers/adminController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

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
| SUPER ADMIN - ADMIN MANAGEMENT
|--------------------------------------------------------------------------
*/

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
    createAdmin
);

router.put(
    "/:id",
    protect,
    authorize("SUPER_ADMIN"),
    updateAdmin
);

router.patch(
    "/:id/status",
    protect,
    authorize("SUPER_ADMIN"),
    updateAdminStatus
);

router.delete(
    "/:id",
    protect,
    authorize("SUPER_ADMIN"),
    deleteAdmin
);

// ============================================================
// RESET PASSWORD USING 2FA
// ============================================================

router.post(
    "/password/reset-2fa",
    protect,
    resetPasswordWithTwoFactor
);

export default router;