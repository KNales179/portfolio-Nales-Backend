import mongoose from "mongoose";

const workTaskSchema = new mongoose.Schema(
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
        // BASIC INFORMATION
        // ============================================================

        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },

        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },


        // ============================================================
        // COMPLETION
        // ============================================================

        /*
         * Completion is NOT a manually controlled status field
         * when subtasks exist.
         *
         * The controller determines completion using:
         *
         * No subtasks:
         *      direct task checkbox
         *
         * With subtasks:
         *      derived from subtask completion
         *
         * The status is therefore persisted as the current
         * derived state for efficient querying.
         */
        status: {
            type: String,
            enum: [
                "INCOMPLETE",
                "COMPLETED",
                "ARCHIVED",
            ],
            default: "INCOMPLETE",
            required: true,
        },

        completedAt: {
            type: Date,
            default: null,
        },

        completedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
        },


        // ============================================================
        // DIRECT CHECKBOX STATE
        // ============================================================

        /*
         * Used when this Task has NO active subtasks.
         *
         * When active subtasks exist, completion is derived
         * from the Subtasks and this value should not be treated
         * as an independent source of truth.
         */
        completed: {
            type: Boolean,
            default: false,
            required: true,
        },


        // ============================================================
        // ORDERING
        // ============================================================

        order: {
            type: Number,
            default: 0,
            required: true,
        },


        // ============================================================
        // ARCHIVE
        // ============================================================

        archivedAt: {
            type: Date,
            default: null,
        },

        archivedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
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

workTaskSchema.index({
    work: 1,
    order: 1,
});

workTaskSchema.index({
    work: 1,
    status: 1,
});

workTaskSchema.index({
    work: 1,
    archivedAt: 1,
});

workTaskSchema.index({
    work: 1,
    completed: 1,
});

workTaskSchema.index({
    createdBy: 1,
});


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "WorkTask",
    workTaskSchema
);