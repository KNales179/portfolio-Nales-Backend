import AuditLog from "../models/AuditLog.js";


// ============================================================
// CONTENT AUDIT
// ============================================================
//
// Writes an audit-log entry for every editable-content change,
// so there is a who / what / when trail for the portfolio CMS.
// Field diffs go in `metadata` (before / after per field).
// ============================================================


const truncate = (value, max = 300) => {
    const str =
        typeof value === "string"
            ? value
            : JSON.stringify(value);

    if (str == null) {
        return null;
    }

    return str.length > max
        ? str.slice(0, max) + "…"
        : str;
};


const isEqual = (a, b) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);


// ------------------------------------------------------------
// DIFF two plain objects over a set of fields.
// Returns [{ field, before, after }] for changed fields only.
// ------------------------------------------------------------

export const diffFields = (before, after, fields) => {
    const changes = [];

    for (const field of fields) {
        if (!(field in after)) {
            continue;
        }

        if (!isEqual(before?.[field], after[field])) {
            changes.push({
                field,
                before: before?.[field] ?? null,
                after: after[field],
            });
        }
    }

    return changes;
};


// ------------------------------------------------------------
// RECORD a content change.
//
//   action:   "CREATE" | "UPDATE" | "DELETE"
//   resource: "PROJECT" | "SKILL" | ...
// ------------------------------------------------------------

export const recordContentChange = async ({
    req,
    action,
    resource,
    resourceId,
    resourceName,
    changes = [],
}) => {
    try {
        let description;

        if (action === "CREATE") {
            description = `Created ${resource.toLowerCase()} "${resourceName}"`;
        } else if (action === "DELETE") {
            description = `Archived ${resource.toLowerCase()} "${resourceName}"`;
        } else if (changes.length === 0) {
            return;
        } else if (changes.length === 1) {
            description = `Updated ${changes[0].field} of ${resource.toLowerCase()} "${resourceName}"`;
        } else {
            description = `Updated ${changes.length} fields of ${resource.toLowerCase()} "${resourceName}"`;
        }

        await AuditLog.create({
            admin: req.user._id,
            action,
            resource,
            resourceId,
            description: description.slice(0, 500),
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
            metadata: {
                resourceName,
                changes: changes.map((change) => ({
                    field: change.field,
                    before: truncate(change.before),
                    after: truncate(change.after),
                })),
            },
        });
    } catch (error) {
        // Never let an audit-log failure block the content save.
        console.error(
            "Content audit log failed:",
            error.message
        );
    }
};
