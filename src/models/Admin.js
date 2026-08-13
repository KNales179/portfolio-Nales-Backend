import mongoose from "mongoose";

const trustedDeviceSchema = new mongoose.Schema(
    {
        deviceId: {
            type: String,
            required: true,
        },

        deviceName: {
            type: String,
            default: "Unknown Device",
            trim: true,
        },

        ipAddress: {
            type: String,
            default: null,
        },

        userAgent: {
            type: String,
            default: null,
        },

        lastUsedAt: {
            type: Date,
            default: Date.now,
        },

        expiresAt: {
            type: Date,
            default: null,
        },
    },
    {
        _id: false,
    }
);

const adminSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            minlength: 3,
            maxlength: 30,
        },

        password: {
            type: String,
            required: true,
            minlength: 8,
            select: false,
        },

        fullName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        email: {
            type: String,
            trim: true,
            lowercase: true,
            default: null,
        },

        phone: {
            type: String,
            trim: true,
            default: null,
        },

        profileImage: {
            url: {
                type: String,
                default: null,
            },

            publicId: {
                type: String,
                default: null,
            },
        },

        role: {
            type: String,
            enum: ["SUPER_ADMIN", "ADMIN"],
            default: "ADMIN",
            required: true,
        },

        status: {
            type: String,
            enum: ["ACTIVE", "INACTIVE"],
            default: "ACTIVE",
            required: true,
        },

        mustChangePassword: {
            type: Boolean,
            default: false,
        },

        twoFactorEnabled: {
            type: Boolean,
            default: false,
        },

        twoFactorSecret: {
            type: String,
            default: null,
            select: false,
        },

        trustedDevices: {
            type: [trustedDeviceSchema],
            default: [],
        },

        lastLogin: {
            type: Date,
            default: null,
        },

        lastLoginIP: {
            type: String,
            default: null,
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model("Admin", adminSchema);