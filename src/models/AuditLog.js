import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
    {
        admin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
        },

        action: {
            type: String,
            enum: [
                "LOGIN",
                "LOGIN_FAILED",
                "LOGOUT",

                "CREATE",
                "UPDATE",
                "DELETE",

                "ACTIVATE",
                "DEACTIVATE",

                "PASSWORD_CHANGE",

                "2FA_ENABLED",
                "2FA_DISABLED",

                "TRUSTED_DEVICE_ADDED",
                "TRUSTED_DEVICE_REMOVED",

                "PROFILE_UPDATE",
            ],
            required: true,
        },

        resource: {
            type: String,
            enum: [
                "ADMIN",
                "PROJECT",
                "CERTIFICATE",
                "SKILL",
                "HOBBY",
                "JOURNEY",
                "AWARD",
                "MESSAGE",
                "CONTACT",
                "PROFILE",
                "HERO",
                "SYSTEM",
            ],
            required: true,
        },

        resourceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },

        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
        },

        ipAddress: {
            type: String,
            default: null,
        },

        userAgent: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ admin: 1, createdAt: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1 });

export default mongoose.model("AuditLog", auditLogSchema);