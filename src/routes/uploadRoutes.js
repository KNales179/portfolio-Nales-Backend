import express from "express";

import {
    uploadImage,
    getUpload,
    getMyUploads,
    deleteImage,
    uploadProfileImage,
    deleteProfileImage,
} from "../controllers/uploadController.js";

import { protect } from "../middleware/authMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();

// ============================================================
// PROFILE IMAGE
// ============================================================

// Upload / replace current admin profile image
router.post(
    "/profile-image",
    protect,
    upload.single("profileImage"),
    uploadProfileImage
);

// Delete current admin profile image
router.delete(
    "/profile-image",
    protect,
    deleteProfileImage
);

// ============================================================
// GENERAL IMAGE UPLOAD
// ============================================================

// Upload image
router.post(
    "/",
    protect,
    upload.single("image"),
    uploadImage
);

// ============================================================
// GET MY UPLOADS
// ============================================================

// Get my uploaded images
router.get(
    "/my",
    protect,
    getMyUploads
);

// ============================================================
// GET ONE UPLOAD
// ============================================================

// Get one upload
router.get(
    "/:id",
    protect,
    getUpload
);

// ============================================================
// DELETE GENERAL IMAGE
// ============================================================

// Delete upload
router.delete(
    "/:id",
    protect,
    deleteImage
);

export default router;