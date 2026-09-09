import express from "express";

import {
    getPublicProjects,
    getAllProjects,
    createProject,
    updateProject,
    archiveProject,
    restoreProject,
    reorderProjects,
} from "../controllers/projectController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();


// ============================================================
// PUBLIC
// ============================================================

router.get("/", getPublicProjects);


// ============================================================
// ADMIN
// ============================================================
//
// Specific paths before "/:id" so they aren't swallowed by it.
// ============================================================

router.get("/all", protect, getAllProjects);

router.post("/", protect, createProject);

router.patch("/reorder", protect, reorderProjects);

router.post("/:id/archive", protect, archiveProject);

router.post("/:id/restore", protect, restoreProject);

router.patch("/:id", protect, updateProject);


export default router;
