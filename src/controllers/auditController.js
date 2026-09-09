import mongoose from "mongoose";

import AuditLog from "../models/AuditLog.js";
import Admin from "../models/Admin.js";


// ============================================================
// AUDIT LOG READS  (SUPER_ADMIN)
// ============================================================
//
// Backs the admin "Audit Logs" page. Every editable-content
// change already writes an AuditLog (see utils/contentAudit.js);
// this just lists them with filters + pagination.
// ============================================================

// The resources produced by the portfolio CMS. The default view
// is scoped to these; `?scope=all` widens to auth / admin /
// work events too.
const CONTENT_RESOURCES = [
    "PROJECT",
    "CERTIFICATE",
    "SKILL",
    "HOBBY",
    "JOURNEY",
    "AWARD",
    "CONTACT",
    "PROFILE",
    "HERO",
];


const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");


const serialize = (log) => ({
    id: log._id,
    action: log.action,
    resource: log.resource,
    resourceId: log.resourceId || null,
    resourceName: log.metadata?.resourceName || null,
    description: log.description,
    changes: Array.isArray(log.metadata?.changes)
        ? log.metadata.changes
        : [],
    admin: log.admin
        ? {
              id: log.admin._id,
              username: log.admin.username,
              fullName: log.admin.fullName,
              role: log.admin.role,
          }
        : null,
    ipAddress: log.ipAddress || null,
    userAgent: log.userAgent || null,
    createdAt: log.createdAt,
});


export const getAuditLogs = async (req, res) => {
    try {
        const page = Math.max(
            parseInt(req.query.page, 10) || 1,
            1
        );
        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 25, 1),
            100
        );

        const scopeFilter = {};

        if (req.query.scope !== "all") {
            scopeFilter.resource = { $in: CONTENT_RESOURCES };
        }

        const filter = { ...scopeFilter };

        if (req.query.resource) {
            filter.resource = req.query.resource;
        }

        if (req.query.action) {
            filter.action = req.query.action;
        }

        if (
            req.query.adminId &&
            mongoose.isValidObjectId(req.query.adminId)
        ) {
            filter.admin = req.query.adminId;
        }

        if (req.query.q) {
            filter.description = {
                $regex: escapeRegex(req.query.q.trim()),
                $options: "i",
            };
        }

        const [logs, total, adminIds] = await Promise.all([
            AuditLog.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .populate("admin", "username fullName role")
                .lean(),
            AuditLog.countDocuments(filter),
            AuditLog.distinct("admin", scopeFilter),
        ]);

        const admins = await Admin.find({
            _id: { $in: adminIds },
        })
            .select("username fullName role")
            .lean();

        return res.json({
            success: true,
            data: {
                logs: logs.map(serialize),
                total,
                page,
                pages: Math.ceil(total / limit) || 1,
                admins: admins.map((admin) => ({
                    id: admin._id,
                    username: admin.username,
                    fullName: admin.fullName,
                    role: admin.role,
                })),
            },
        });
    } catch (error) {
        console.error(
            "Get audit logs error:",
            error.message
        );
        return res.status(500).json({
            success: false,
            message: "Unable to load audit logs.",
        });
    }
};
