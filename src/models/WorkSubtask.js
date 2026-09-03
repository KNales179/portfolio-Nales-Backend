import mongoose from "mongoose";

const workSubtaskSchema = new mongoose.Schema(
    {
        // ============================================================
        // PARENT TASK
        // ============================================================

        task: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WorkTask",
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
            trim: true,
            maxlength: 2000,
            default: "",
        },


        // ============================================================
        // STATUS
        // ============================================================

        /*
         * Used only for archive lifecycle (INCOMPLETE / ARCHIVED).
         * Completion itself is tracked separately via `completed`
         * below — this field does not flip to "COMPLETED".
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


        // ============================================================
        // COMPLETION
        // ============================================================

        completed: {
            type: Boolean,
            default: false,
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

workSubtaskSchema.index({
    task: 1,
    order: 1,
});

workSubtaskSchema.index({
    task: 1,
    completed: 1,
});

workSubtaskSchema.index({
    task: 1,
    status: 1,
});

workSubtaskSchema.index({
    task: 1,
    archivedAt: 1,
});

workSubtaskSchema.index({
    createdBy: 1,
});


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "WorkSubtask",
    workSubtaskSchema
);