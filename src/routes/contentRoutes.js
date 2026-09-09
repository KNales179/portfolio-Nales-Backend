import express from "express";

import {
    getSiteText,
    updateSiteText,
    getAllPublicContent,
    collectionMiddleware,
} from "../controllers/contentController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();


// ============================================================
// PUBLIC — everything at once
// ============================================================

router.get("/", getAllPublicContent);


// ============================================================
// SITE TEXT (hero / about headers)
// ============================================================

router.get("/text/:key", getSiteText);
router.patch("/text/:key", protect, updateSiteText);


// ============================================================
// LIST COLLECTIONS  — /api/content/:type/...
//
// type: skills | journey | awards | hobbies | certificates |
//       contact-links | strengths
// ============================================================

router.get(
    "/:type",
    collectionMiddleware,
    (req, res) => req.collection.getPublic(req, res)
);

router.get(
    "/:type/all",
    protect,
    collectionMiddleware,
    (req, res) => req.collection.getAll(req, res)
);

router.post(
    "/:type",
    protect,
    collectionMiddleware,
    (req, res) => req.collection.create(req, res)
);

router.patch(
    "/:type/reorder",
    protect,
    collectionMiddleware,
    (req, res) => req.collection.reorder(req, res)
);

router.post(
    "/:type/:id/archive",
    protect,
    collectionMiddleware,
    (req, res) => req.collection.archive(req, res)
);

router.post(
    "/:type/:id/restore",
    protect,
    collectionMiddleware,
    (req, res) => req.collection.restore(req, res)
);

router.patch(
    "/:type/:id",
    protect,
    collectionMiddleware,
    (req, res) => req.collection.update(req, res)
);


export default router;
