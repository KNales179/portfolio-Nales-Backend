import mongoose from "mongoose";

import {
    diffFields,
    recordContentChange,
} from "./contentAudit.js";


// ============================================================
// CONTENT COLLECTION FACTORY
// ============================================================
//
// Most editable portfolio content is "an ordered list of small
// records" (skills, journey milestones, awards, hobbies,
// certificates, contact links, strengths). They all need the
// same endpoints, so this builds the controller set for any
// such model:
//
//   getPublic  GET  /            non-archived, ordered
//   getAll     GET  /all         everything, ordered   (admin)
//   create     POST /                                  (admin)
//   update     PATCH /:id        partial, diff + audit (admin)
//   archive    POST /:id/archive                       (admin)
//   restore    POST /:id/restore                       (admin)
//   reorder    PATCH /reorder    { orderedIds }        (admin)
//
// config:
//   resource       AuditLog resource string ("SKILL", ...)
//   fields         editable field names
//   stringFields   subset of `fields` that are plain strings
//   arrayFields    subset that are string arrays
//   boolFields     subset that are booleans
//   requiredField  a field that must be non-empty (default "title")
// ============================================================

export const makeContentCollection = (Model, config) => {
    const {
        resource,
        fields,
        stringFields = [],
        arrayFields = [],
        boolFields = [],
        requiredField = "title",
    } = config;

    const stringSet = new Set(stringFields);
    const arraySet = new Set(arrayFields);
    const boolSet = new Set(boolFields);

    const serialize = (doc) => {
        const out = { id: doc._id, order: doc.order };
        for (const field of fields) {
            out[field] = doc[field];
        }
        return out;
    };

    const serializeAdmin = (doc) => ({
        ...serialize(doc),
        archivedAt: doc.archivedAt,
        updatedAt: doc.updatedAt,
    });

    const sanitizeArray = (value) =>
        Array.isArray(value)
            ? value
                  .filter((v) => typeof v === "string")
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .slice(0, 100)
            : [];

    const buildPatch = (body) => {
        const patch = {};
        for (const field of fields) {
            if (!(field in body)) {
                continue;
            }
            const value = body[field];

            if (stringSet.has(field)) {
                patch[field] =
                    typeof value === "string"
                        ? value.trim()
                        : "";
            } else if (arraySet.has(field)) {
                patch[field] = sanitizeArray(value);
            } else if (boolSet.has(field)) {
                patch[field] = Boolean(value);
            }
        }
        return patch;
    };

    const nameOf = (doc) =>
        doc[requiredField] ||
        doc.name ||
        doc.label ||
        doc.title ||
        "item";


    return {
        serialize,
        serializeAdmin,

        // ----------------------------------------------------

        getPublic: async (req, res) => {
            try {
                const rows = await Model.find({
                    archivedAt: null,
                })
                    .sort({ order: 1, createdAt: 1 })
                    .lean();

                return res.json({
                    success: true,
                    data: { items: rows.map(serialize) },
                });
            } catch (error) {
                console.error(
                    `Get ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to load content.",
                });
            }
        },

        getAll: async (req, res) => {
            try {
                const rows = await Model.find({})
                    .sort({ order: 1, createdAt: 1 })
                    .lean();

                return res.json({
                    success: true,
                    data: {
                        items: rows.map(serializeAdmin),
                    },
                });
            } catch (error) {
                console.error(
                    `Get all ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to load content.",
                });
            }
        },

        create: async (req, res) => {
            try {
                const patch = buildPatch(req.body);

                if (!patch[requiredField]) {
                    return res.status(400).json({
                        success: false,
                        message: `A ${requiredField} is required.`,
                    });
                }

                const last = await Model.findOne({})
                    .sort({ order: -1 })
                    .select("order")
                    .lean();

                const doc = await Model.create({
                    ...patch,
                    order: (last?.order ?? 0) + 1,
                    updatedBy: req.user._id,
                });

                await recordContentChange({
                    req,
                    action: "CREATE",
                    resource,
                    resourceId: doc._id,
                    resourceName: nameOf(doc),
                });

                return res.status(201).json({
                    success: true,
                    data: { item: serializeAdmin(doc) },
                });
            } catch (error) {
                console.error(
                    `Create ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to create item.",
                });
            }
        },

        update: async (req, res) => {
            try {
                const { id } = req.params;

                if (!mongoose.isValidObjectId(id)) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid reference.",
                    });
                }

                const doc = await Model.findById(id);

                if (!doc) {
                    return res.status(404).json({
                        success: false,
                        message: "Item not found.",
                    });
                }

                const patch = buildPatch(req.body);

                if (Object.keys(patch).length === 0) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "No editable fields provided.",
                    });
                }

                if (
                    requiredField in patch &&
                    !patch[requiredField]
                ) {
                    return res.status(400).json({
                        success: false,
                        message: `The ${requiredField} cannot be empty.`,
                    });
                }

                const before = doc.toObject();
                Object.assign(doc, patch);
                doc.updatedBy = req.user._id;
                await doc.save();

                const changes = diffFields(
                    before,
                    doc.toObject(),
                    Object.keys(patch)
                );

                await recordContentChange({
                    req,
                    action: "UPDATE",
                    resource,
                    resourceId: doc._id,
                    resourceName: nameOf(doc),
                    changes,
                });

                return res.json({
                    success: true,
                    data: { item: serializeAdmin(doc) },
                });
            } catch (error) {
                console.error(
                    `Update ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to update item.",
                });
            }
        },

        archive: async (req, res) => {
            try {
                const doc = await Model.findById(
                    req.params.id
                );
                if (!doc) {
                    return res.status(404).json({
                        success: false,
                        message: "Item not found.",
                    });
                }
                if (!doc.archivedAt) {
                    doc.archivedAt = new Date();
                    doc.updatedBy = req.user._id;
                    await doc.save();
                    await recordContentChange({
                        req,
                        action: "DELETE",
                        resource,
                        resourceId: doc._id,
                        resourceName: nameOf(doc),
                    });
                }
                return res.json({
                    success: true,
                    data: { item: serializeAdmin(doc) },
                });
            } catch (error) {
                console.error(
                    `Archive ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to archive item.",
                });
            }
        },

        restore: async (req, res) => {
            try {
                const doc = await Model.findById(
                    req.params.id
                );
                if (!doc) {
                    return res.status(404).json({
                        success: false,
                        message: "Item not found.",
                    });
                }
                if (doc.archivedAt) {
                    doc.archivedAt = null;
                    doc.updatedBy = req.user._id;
                    await doc.save();
                    await recordContentChange({
                        req,
                        action: "UPDATE",
                        resource,
                        resourceId: doc._id,
                        resourceName: nameOf(doc),
                        changes: [
                            {
                                field: "archivedAt",
                                before: "archived",
                                after: "restored",
                            },
                        ],
                    });
                }
                return res.json({
                    success: true,
                    data: { item: serializeAdmin(doc) },
                });
            } catch (error) {
                console.error(
                    `Restore ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to restore item.",
                });
            }
        },

        reorder: async (req, res) => {
            try {
                const orderedIds = req.body?.orderedIds;
                if (!Array.isArray(orderedIds)) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "orderedIds must be an array.",
                    });
                }

                const valid = orderedIds.filter((id) =>
                    mongoose.isValidObjectId(id)
                );

                await Model.bulkWrite(
                    valid.map((id, index) => ({
                        updateOne: {
                            filter: { _id: id },
                            update: {
                                $set: { order: index + 1 },
                            },
                        },
                    }))
                );

                await recordContentChange({
                    req,
                    action: "UPDATE",
                    resource,
                    resourceId: null,
                    resourceName: `${resource.toLowerCase()} order`,
                    changes: [
                        {
                            field: "order",
                            before: "—",
                            after: `${valid.length} items reordered`,
                        },
                    ],
                });

                return res.json({ success: true });
            } catch (error) {
                console.error(
                    `Reorder ${resource} error:`,
                    error.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to reorder items.",
                });
            }
        },
    };
};
