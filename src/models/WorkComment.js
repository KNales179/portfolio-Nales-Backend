import mongoose from "mongoose";

const workCommentSchema = new mongoose.Schema(
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
        // AUTHOR
        // ============================================================

        admin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
            immutable: true,
        },


        // ============================================================
        // CONTENT
        // ============================================================

        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },
    },
    {
        timestamps: true,
    }
);


// ============================================================
// INDEXES
// ============================================================

workCommentSchema.index({
    work: 1,
    createdAt: 1,
});

workCommentSchema.index({
    admin: 1,
});


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "WorkComment",
    workCommentSchema
);