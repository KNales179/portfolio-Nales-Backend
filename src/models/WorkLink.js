import mongoose from "mongoose";

const workLinkSchema = new mongoose.Schema(
    {
        // ============================================================
        // PARENT WORK
        // ============================================================

        work: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Work",
            required: true,
            index: true,
        },


        // ============================================================
        // CONTENT
        // ============================================================

        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },

        /*
         * HTTPS only. Validated in the controller before save
         * (javascript:, data:, file:, and plain http: are rejected).
         */
        url: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: "",
        },


        // ============================================================
        // CREATION / UPDATE
        // ============================================================

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
            immutable: true,
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
        },
    },
    {
        timestamps: true,
    }
);


// ============================================================
// INDEXES
// ============================================================

workLinkSchema.index({
    work: 1,
    createdAt: 1,
});

workLinkSchema.index({
    createdBy: 1,
});


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "WorkLink",
    workLinkSchema
);