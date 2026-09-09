import mongoose from "mongoose";

import Project from "../models/Project.js";
import {
    diffFields,
    recordContentChange,
} from "../utils/contentAudit.js";


// ============================================================
// CONFIG
// ============================================================

// Fields an admin may change through the inline editor.
const EDITABLE_FIELDS = [
    "name",
    "type",
    "description",
    "layout",
    "status",
    "github",
    "liveLink",
    "demoLink",
    "image",
    "technologies",
    "notes",
    "descriptions",
];

const STRING_FIELDS = new Set([
    "name",
    "type",
    "description",
    "layout",
    "status",
    "github",
    "liveLink",
    "demoLink",
    "image",
]);


// ============================================================
// SERIALIZERS
// ============================================================

const publicProject = (doc) => ({
    id: doc._id,
    slug: doc.slug,
    name: doc.name,
    type: doc.type,
    description: doc.description,
    layout: doc.layout,
    status: doc.status,
    github: doc.github,
    liveLink: doc.liveLink,
    demoLink: doc.demoLink,
    image: doc.image,
    technologies: doc.technologies,
    notes: doc.notes,
    descriptions: doc.descriptions,
    order: doc.order,
});


const adminProject = (doc) => ({
    ...publicProject(doc),
    archivedAt: doc.archivedAt,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
});


// ============================================================
// SANITIZE AN INCOMING PATCH
// ============================================================

const sanitizeStringArray = (value, maxItems = 60) => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems);
};


const sanitizeNotes = (value) => {
    const source =
        value && typeof value === "object" ? value : {};

    return {
        learned: sanitizeStringArray(source.learned),
        challenges: sanitizeStringArray(source.challenges),
        technical: sanitizeStringArray(source.technical),
        reflection: sanitizeStringArray(source.reflection),
    };
};


const sanitizeDescriptions = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.slice(0, 40).map((block) => ({
        images: sanitizeStringArray(block?.images, 12),
        texts: (Array.isArray(block?.texts)
            ? block.texts
            : []
        )
            .filter((t) => typeof t === "string")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 20),
    }));
};


const buildPatch = (body) => {
    const patch = {};

    for (const field of EDITABLE_FIELDS) {
        if (!(field in body)) {
            continue;
        }

        const value = body[field];

        if (STRING_FIELDS.has(field)) {
            patch[field] =
                typeof value === "string"
                    ? value.trim()
                    : "";
        } else if (field === "technologies") {
            patch[field] = sanitizeStringArray(value);
        } else if (field === "notes") {
            patch[field] = sanitizeNotes(value);
        } else if (field === "descriptions") {
            patch[field] = sanitizeDescriptions(value);
        }
    }

    return patch;
};


// ============================================================
// PUBLIC — LIST
// ============================================================
//
// GET /api/projects
// ============================================================

export const getPublicProjects = async (req, res) => {
    try {
        const projects = await Project.find({
            archivedAt: null,
        })
            .sort({ order: 1, createdAt: 1 })
            .lean();

        return res.json({
            success: true,
            data: {
                projects: projects.map(publicProject),
            },
        });
    } catch (error) {
        console.error(
            "Get public projects error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load projects.",
        });
    }
};


// ============================================================
// ADMIN — LIST (includes archived)
// ============================================================
//
// GET /api/projects/all
// ============================================================

export const getAllProjects = async (req, res) => {
    try {
        const projects = await Project.find({})
            .sort({ order: 1, createdAt: 1 })
            .lean();

        return res.json({
            success: true,
            data: {
                projects: projects.map(adminProject),
            },
        });
    } catch (error) {
        console.error(
            "Get all projects error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load projects.",
        });
    }
};


// ============================================================
// ADMIN — CREATE
// ============================================================
//
// POST /api/projects
// ============================================================

export const createProject = async (req, res) => {
    try {
        const name =
            typeof req.body?.name === "string"
                ? req.body.name.trim()
                : "";

        if (!name) {
            return res.status(400).json({
                success: false,
                message: "A project name is required.",
            });
        }

        const last = await Project.findOne({})
            .sort({ order: -1 })
            .select("order")
            .lean();

        const patch = buildPatch(req.body);

        const project = await Project.create({
            ...patch,
            name,
            order: (last?.order ?? 0) + 1,
            updatedBy: req.user._id,
        });

        await recordContentChange({
            req,
            action: "CREATE",
            resource: "PROJECT",
            resourceId: project._id,
            resourceName: project.name,
        });

        return res.status(201).json({
            success: true,
            data: { project: adminProject(project) },
        });
    } catch (error) {
        console.error(
            "Create project error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to create project.",
        });
    }
};


// ============================================================
// ADMIN — UPDATE (inline edit)
// ============================================================
//
// PATCH /api/projects/:id
// Body: any subset of the editable fields.
// ============================================================

export const updateProject = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid project reference.",
            });
        }

        const project = await Project.findById(id);

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found.",
            });
        }

        const patch = buildPatch(req.body);

        if (Object.keys(patch).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No editable fields provided.",
            });
        }

        if (patch.name === "") {
            return res.status(400).json({
                success: false,
                message: "The project name cannot be empty.",
            });
        }

        const before = project.toObject();

        Object.assign(project, patch);
        project.updatedBy = req.user._id;

        await project.save();

        const changes = diffFields(
            before,
            project.toObject(),
            Object.keys(patch)
        );

        await recordContentChange({
            req,
            action: "UPDATE",
            resource: "PROJECT",
            resourceId: project._id,
            resourceName: project.name,
            changes,
        });

        return res.json({
            success: true,
            data: { project: adminProject(project) },
        });
    } catch (error) {
        console.error(
            "Update project error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to update project.",
        });
    }
};


// ============================================================
// ADMIN — ARCHIVE / RESTORE
// ============================================================

export const archiveProject = async (req, res) => {
    try {
        const project = await Project.findById(
            req.params.id
        );

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found.",
            });
        }

        if (!project.archivedAt) {
            project.archivedAt = new Date();
            project.updatedBy = req.user._id;
            await project.save();

            await recordContentChange({
                req,
                action: "DELETE",
                resource: "PROJECT",
                resourceId: project._id,
                resourceName: project.name,
            });
        }

        return res.json({
            success: true,
            data: { project: adminProject(project) },
        });
    } catch (error) {
        console.error(
            "Archive project error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to archive project.",
        });
    }
};


export const restoreProject = async (req, res) => {
    try {
        const project = await Project.findById(
            req.params.id
        );

        if (!project) {
            return res.status(404).json({
                success: false,
                message: "Project not found.",
            });
        }

        if (project.archivedAt) {
            project.archivedAt = null;
            project.updatedBy = req.user._id;
            await project.save();

            await recordContentChange({
                req,
                action: "UPDATE",
                resource: "PROJECT",
                resourceId: project._id,
                resourceName: project.name,
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
            data: { project: adminProject(project) },
        });
    } catch (error) {
        console.error(
            "Restore project error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to restore project.",
        });
    }
};


// ============================================================
// ADMIN — REORDER
// ============================================================
//
// PATCH /api/projects/reorder
// Body: { orderedIds: [id, id, ...] }
// ============================================================

export const reorderProjects = async (req, res) => {
    try {
        const orderedIds = req.body?.orderedIds;

        if (!Array.isArray(orderedIds)) {
            return res.status(400).json({
                success: false,
                message: "orderedIds must be an array.",
            });
        }

        const valid = orderedIds.filter((id) =>
            mongoose.isValidObjectId(id)
        );

        await Project.bulkWrite(
            valid.map((id, index) => ({
                updateOne: {
                    filter: { _id: id },
                    update: { $set: { order: index + 1 } },
                },
            }))
        );

        await recordContentChange({
            req,
            action: "UPDATE",
            resource: "PROJECT",
            resourceId: null,
            resourceName: "project order",
            changes: [
                {
                    field: "order",
                    before: "—",
                    after: `${valid.length} projects reordered`,
                },
            ],
        });

        return res.json({ success: true });
    } catch (error) {
        console.error(
            "Reorder projects error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to reorder projects.",
        });
    }
};
