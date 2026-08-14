import mongoose from "mongoose";

const adminSessionSchema = new mongoose.Schema(
    {
        admin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
            index: true,
        },

        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        deviceId: {
            type: String,
            required: true,
            index: true,
        },

        deviceName: {
            type: String,
            default: "Unknown Device",
            trim: true,
        },

        browser: {
            type: String,
            default: "Unknown Browser",
            trim: true,
        },

        operatingSystem: {
            type: String,
            default: "Unknown OS",
            trim: true,
        },

        ipAddress: {
            type: String,
            default: null,
        },

        location: {
            country: {
                type: String,
                default: null,
            },

            countryCode: {
                type: String,
                default: null,
            },

            region: {
                type: String,
                default: null,
            },

            city: {
                type: String,
                default: null,
            },

            latitude: {
                type: Number,
                default: null,
            },

            longitude: {
                type: Number,
                default: null,
            },

            accuracyRadius: {
                type: Number,
                default: null,
            },
        },

        userAgent: {
            type: String,
            default: null,
        },

        firstLoginAt: {
            type: Date,
            default: Date.now,
        },

        lastUsedAt: {
            type: Date,
            default: Date.now,
        },

        expiresAt: {
            type: Date,
            default: null,
        },

        revokedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model(
    "AdminSession",
    adminSessionSchema
);