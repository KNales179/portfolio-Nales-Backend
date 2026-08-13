import Hero from "../models/Hero.js";
import AuditLog from "../models/AuditLog.js";

// ============================================================
// GET HERO
// ============================================================

export const getHero = async (req, res) => {
    try {
        let hero = await Hero.findOne();

        /*
        |--------------------------------------------------------------------------
        | Create default Hero document if none exists
        |--------------------------------------------------------------------------
        */

        if (!hero) {
            hero = await Hero.create({
                headline: "Mobile & Full Stack Developer",
                description:
                    "I'm a developer who enjoys turning ideas into useful applications.",
                profileImage: null,
            });
        }

        res.json({
            success: true,
            data: hero,
        });
    } catch (error) {
        console.error("Get hero error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to retrieve hero content",
        });
    }
};

// ============================================================
// UPDATE HERO
// ============================================================

export const updateHero = async (req, res) => {
    try {
        const allowedFields = [
            "headline",
            "description",
            "profileImage",
        ];

        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid fields provided for update",
            });
        }

        /*
        |--------------------------------------------------------------------------
        | Clean text fields
        |--------------------------------------------------------------------------
        */

        if (updates.headline !== undefined) {
            if (!updates.headline.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Headline cannot be empty",
                });
            }

            updates.headline = updates.headline.trim();
        }

        if (updates.description !== undefined) {
            if (!updates.description.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Description cannot be empty",
                });
            }

            updates.description = updates.description.trim();
        }

        /*
        |--------------------------------------------------------------------------
        | Find existing Hero
        |--------------------------------------------------------------------------
        */

        let hero = await Hero.findOne();

        /*
        |--------------------------------------------------------------------------
        | Create if it doesn't exist
        |--------------------------------------------------------------------------
        */

        if (!hero) {
            hero = await Hero.create({
                headline:
                    updates.headline ||
                    "Mobile & Full Stack Developer",

                description:
                    updates.description ||
                    "I'm a developer who enjoys turning ideas into useful applications.",

                profileImage:
                    updates.profileImage || null,
            });
        } else {
            /*
            |--------------------------------------------------------------------------
            | Update existing Hero
            |--------------------------------------------------------------------------
            */

            Object.assign(hero, updates);

            await hero.save();
        }

        /*
        |--------------------------------------------------------------------------
        | Audit Log
        |--------------------------------------------------------------------------
        */

        await AuditLog.create({
            admin: req.user._id,
            action: "UPDATE",
            resource: "HERO",
            resourceId: hero._id,
            description: "Updated portfolio hero section",
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
        });

        res.json({
            success: true,
            message: "Hero section updated successfully",
            data: hero,
        });
    } catch (error) {
        console.error("Update hero error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to update hero section",
        });
    }
};