import express from "express";

import {
    getHero,
    updateHero,
} from "../controllers/heroController.js";

import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| PUBLIC
|--------------------------------------------------------------------------
*/

// GET /api/hero
router.get("/", getHero);

/*
|--------------------------------------------------------------------------
| ADMIN
|--------------------------------------------------------------------------
*/

// PUT /api/hero
router.put(
    "/",
    protect,
    authorize("SUPER_ADMIN", "ADMIN"),
    updateHero
);

export default router;