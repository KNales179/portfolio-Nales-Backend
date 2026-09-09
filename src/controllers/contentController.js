import mongoose from "mongoose";

import {
    Skill,
    JourneyMilestone,
    Award,
    Hobby,
    Certificate,
    ContactLink,
    Strength,
    SiteText,
} from "../models/contentModels.js";

import { makeContentCollection } from "../utils/contentCollection.js";
import { recordContentChange } from "../utils/contentAudit.js";


// ============================================================
// LIST COLLECTIONS
// ============================================================

export const collections = {
    skills: makeContentCollection(Skill, {
        resource: "SKILL",
        fields: ["name", "icon", "items"],
        stringFields: ["name", "icon"],
        arrayFields: ["items"],
        requiredField: "name",
    }),

    journey: makeContentCollection(JourneyMilestone, {
        resource: "JOURNEY",
        fields: ["year", "title", "description"],
        stringFields: ["year", "title", "description"],
        requiredField: "title",
    }),

    awards: makeContentCollection(Award, {
        resource: "AWARD",
        fields: ["title", "category", "description", "icon"],
        stringFields: [
            "title",
            "category",
            "description",
            "icon",
        ],
        requiredField: "title",
    }),

    hobbies: makeContentCollection(Hobby, {
        resource: "HOBBY",
        fields: ["title", "description"],
        stringFields: ["title", "description"],
        requiredField: "title",
    }),

    certificates: makeContentCollection(Certificate, {
        resource: "CERTIFICATE",
        fields: ["title", "issuer", "verifyUrl", "image"],
        stringFields: [
            "title",
            "issuer",
            "verifyUrl",
            "image",
        ],
        requiredField: "title",
    }),

    "contact-links": makeContentCollection(ContactLink, {
        resource: "CONTACT",
        fields: [
            "label",
            "value",
            "href",
            "icon",
            "external",
            "download",
        ],
        stringFields: ["label", "value", "href", "icon"],
        boolFields: ["external", "download"],
        requiredField: "label",
    }),

    strengths: makeContentCollection(Strength, {
        resource: "PROFILE",
        fields: ["title", "description", "icon"],
        stringFields: ["title", "description", "icon"],
        requiredField: "title",
    }),
};


// ============================================================
// SITE TEXT SINGLETONS  (hero / about headers)
// ============================================================

const SITE_TEXT_KEYS = {
    hero: ["greeting", "name", "role", "description"],
    about: ["label", "title", "description"],
};


export const getSiteText = async (req, res) => {
    try {
        const { key } = req.params;

        if (!SITE_TEXT_KEYS[key]) {
            return res.status(404).json({
                success: false,
                message: "Unknown content key.",
            });
        }

        const doc = await SiteText.findOne({ key }).lean();

        return res.json({
            success: true,
            data: { key, values: doc?.values || {} },
        });
    } catch (error) {
        console.error(
            "Get site text error:",
            error.message
        );
        return res.status(500).json({
            success: false,
            message: "Unable to load content.",
        });
    }
};


export const updateSiteText = async (req, res) => {
    try {
        const { key } = req.params;
        const allowed = SITE_TEXT_KEYS[key];

        if (!allowed) {
            return res.status(404).json({
                success: false,
                message: "Unknown content key.",
            });
        }

        const patch = {};
        for (const field of allowed) {
            if (typeof req.body?.[field] === "string") {
                patch[field] = req.body[field].trim();
            }
        }

        if (Object.keys(patch).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No editable fields provided.",
            });
        }

        const doc =
            (await SiteText.findOne({ key })) ||
            new SiteText({ key, values: {} });

        const before = { ...(doc.values || {}) };
        doc.values = { ...(doc.values || {}), ...patch };
        doc.updatedBy = req.user._id;
        doc.markModified("values");
        await doc.save();

        const changes = Object.keys(patch)
            .filter(
                (field) => before[field] !== patch[field]
            )
            .map((field) => ({
                field,
                before: before[field] ?? null,
                after: patch[field],
            }));

        await recordContentChange({
            req,
            action: "UPDATE",
            resource: key === "hero" ? "HERO" : "PROFILE",
            resourceId: doc._id,
            resourceName: `${key} section`,
            changes,
        });

        return res.json({
            success: true,
            data: { key, values: doc.values },
        });
    } catch (error) {
        console.error(
            "Update site text error:",
            error.message
        );
        return res.status(500).json({
            success: false,
            message: "Unable to update content.",
        });
    }
};


// ============================================================
// RÉSUMÉ (PDF)  —  stored under the "site" SiteText key
// ============================================================

export const uploadResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No PDF file provided.",
            });
        }

        const cloudinary = req.app.locals.cloudinary;

        const doc =
            (await SiteText.findOne({ key: "site" })) ||
            new SiteText({ key: "site", values: {}, assets: {} });

        const oldPublicId = doc.assets?.resume || null;
        const oldUrl = doc.values?.resumeUrl || null;

        // Cloudinary treats PDFs as "raw" assets.
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: "portfolio/documents",
                    resource_type: "raw",
                    public_id: `resume-${Date.now()}.pdf`,
                },
                (error, uploaded) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(uploaded);
                    }
                }
            );

            stream.end(req.file.buffer);
        });

        doc.values = {
            ...(doc.values || {}),
            resumeUrl: result.secure_url,
        };
        doc.assets = {
            ...(doc.assets || {}),
            resume: result.public_id,
        };
        doc.updatedBy = req.user._id;
        doc.markModified("values");
        doc.markModified("assets");
        await doc.save();

        // Best-effort cleanup of the previous file.
        if (oldPublicId) {
            try {
                await cloudinary.uploader.destroy(oldPublicId, {
                    resource_type: "raw",
                });
            } catch (cleanupError) {
                console.error(
                    "Failed to remove old résumé from Cloudinary:",
                    cleanupError.message
                );
            }
        }

        await recordContentChange({
            req,
            action: "UPDATE",
            resource: "PROFILE",
            resourceId: doc._id,
            resourceName: "résumé",
            changes: [
                {
                    field: "resumeUrl",
                    before: oldUrl,
                    after: result.secure_url,
                },
            ],
        });

        return res.json({
            success: true,
            data: { resumeUrl: result.secure_url },
        });
    } catch (error) {
        console.error("Upload résumé error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to upload the résumé.",
        });
    }
};


// A single call that returns everything the public site needs,
// so the frontend can hydrate in one request.
export const getAllPublicContent = async (req, res) => {
    try {
        const [
            skills,
            journey,
            awards,
            hobbies,
            certificates,
            contactLinks,
            strengths,
            siteTexts,
        ] = await Promise.all([
            Skill.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            JourneyMilestone.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            Award.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            Hobby.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            Certificate.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            ContactLink.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            Strength.find({ archivedAt: null })
                .sort({ order: 1 })
                .lean(),
            SiteText.find({}).lean(),
        ]);

        const strip = (rows) =>
            rows.map((row) => {
                const { _id, __v, archivedAt, updatedBy, updatedAt, createdAt, ...rest } =
                    row;
                void __v;
                void archivedAt;
                void updatedBy;
                void updatedAt;
                void createdAt;
                return { id: _id, ...rest };
            });

        const texts = {};
        for (const doc of siteTexts) {
            texts[doc.key] = doc.values || {};
        }

        return res.json({
            success: true,
            data: {
                skills: strip(skills),
                journey: strip(journey),
                awards: strip(awards),
                hobbies: strip(hobbies),
                certificates: strip(certificates),
                contactLinks: strip(contactLinks),
                strengths: strip(strengths),
                text: texts,
            },
        });
    } catch (error) {
        console.error(
            "Get all public content error:",
            error.message
        );
        return res.status(500).json({
            success: false,
            message: "Unable to load content.",
        });
    }
};


// Guard so an unknown collection name 404s cleanly.
export const collectionMiddleware = (req, res, next) => {
    const collection = collections[req.params.type];

    if (!collection) {
        return res.status(404).json({
            success: false,
            message: "Unknown content type.",
        });
    }

    if (
        req.params.id &&
        !mongoose.isValidObjectId(req.params.id)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid reference.",
        });
    }

    req.collection = collection;
    next();
};
