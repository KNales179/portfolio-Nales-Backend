import mongoose from "mongoose";


// ============================================================
// CHANGE SNAPSHOT
// ============================================================

const changeSnapshotSchema = new mongoose.Schema(
    {
        /*
         * Flexible snapshot.
         *
         * Examples:
         *
         * {
         *     title: "Old title",
         *     description: "Old description"
         * }
         *
         * or:
         *
         * {
         *     status: "IN_PROGRESS"
         * }
         */
        data: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
    },
    {
        _id: false,
    }
);


// ============================================================
// WORK ACTIVITY
// ============================================================

const workActivitySchema = new mongoose.Schema(
    {
        // ============================================================
        // WORK
        // ============================================================

        work: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Work",
            required: true,
            immutable: true,
        },


        // ============================================================
        // ACTOR
        // ============================================================

        admin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
            immutable: true,
        },


        // ============================================================
        // ACTION
        // ============================================================

        action: {
            type: String,
            enum: [
                // ----------------------------------------------------
                // WORK
                // ----------------------------------------------------

                "WORK_CREATED",
                "WORK_UPDATED",
                "WORK_LOCKED",
                "WORK_UNLOCKED",
                "WORK_ARCHIVED",
                "WORK_RESTORED",
                "WORK_REORDERED",
                "WORK_OWNER_CHANGED",

                // ----------------------------------------------------
                // PARTICIPANTS
                // ----------------------------------------------------

                "PARTICIPANT_ADDED",
                "PARTICIPANT_REMOVED",

                // ----------------------------------------------------
                // TASK
                // ----------------------------------------------------

                "TASK_CREATED",
                "TASK_UPDATED",
                "TASK_COMPLETED",
                "TASK_REOPENED",
                "TASK_ARCHIVED",
                "TASK_RESTORED",
                "TASK_REORDERED",

                // ----------------------------------------------------
                // SUBTASK
                // ----------------------------------------------------

                "SUBTASK_CREATED",
                "SUBTASK_UPDATED",
                "SUBTASK_COMPLETED",
                "SUBTASK_REOPENED",
                "SUBTASK_ARCHIVED",
                "SUBTASK_RESTORED",
                "SUBTASK_REORDERED",

                // ----------------------------------------------------
                // COMMENTS
                // ----------------------------------------------------

                "COMMENT_CREATED",
                "COMMENT_UPDATED",
                "COMMENT_DELETED",

                // ----------------------------------------------------
                // LINKS
                // ----------------------------------------------------

                "LINK_CREATED",
                "LINK_UPDATED",
                "LINK_DELETED",
            ],
            required: true,
            immutable: true,
        },


        // ============================================================
        // TARGET TYPE
        // ============================================================

        resourceType: {
            type: String,
            enum: [
                "WORK",
                "TASK",
                "SUBTASK",
                "COMMENT",
                "LINK",
                "PARTICIPANT",
            ],
            required: true,
            immutable: true,
        },


        // ============================================================
        // TARGET IDs
        // ============================================================

        task: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WorkTask",
            default: null,
            immutable: true,
        },

        subtask: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WorkSubtask",
            default: null,
            immutable: true,
        },

        /*
         * Comments and links may later have their own models.
         *
         * Keeping these as generic ObjectIds allows the Activity
         * model to reference them without creating assumptions
         * about their final schema.
         */
        resourceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            immutable: true,
        },


        // ============================================================
        // DESCRIPTION
        // ============================================================

        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
            immutable: true,
        },


        // ============================================================
        // BEFORE / AFTER
        // ============================================================

        /*
         * These are immutable snapshots.
         *
         * Example:
         *
         * before:
         * {
         *     title: "Implement authentication"
         * }
         *
         * after:
         * {
         *     title: "Implement authentication middleware"
         * }
         */
        before: {
            type: changeSnapshotSchema,
            default: null,
            immutable: true,
        },

        after: {
            type: changeSnapshotSchema,
            default: null,
            immutable: true,
        },


        // ============================================================
        // ADDITIONAL METADATA
        // ============================================================

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
            immutable: true,
        },


        // ============================================================
        // REQUEST CONTEXT
        // ============================================================

        ipAddress: {
            type: String,
            default: null,
            immutable: true,
        },

        userAgent: {
            type: String,
            default: null,
            immutable: true,
        },
    },
    {
        timestamps: true,
        strict: true,
    }
);


// ============================================================
// INDEXES
// ============================================================

workActivitySchema.index({
    work: 1,
    createdAt: -1,
});

workActivitySchema.index({
    admin: 1,
    createdAt: -1,
});

workActivitySchema.index({
    work: 1,
    resourceType: 1,
    createdAt: -1,
});

workActivitySchema.index({
    task: 1,
    createdAt: -1,
});

workActivitySchema.index({
    subtask: 1,
    createdAt: -1,
});

workActivitySchema.index({
    resourceId: 1,
    createdAt: -1,
});


// ============================================================
// IMMUTABILITY PROTECTION
// ============================================================

/*
 * WorkActivity is append-only.
 *
 * Application code should never update or delete activity records.
 *
 * These hooks provide an additional model-level safeguard against
 * accidental modification/deletion through normal Mongoose usage.
 */

const immutableOperationError = () => {
    throw new Error(
        "WorkActivity is immutable and cannot be modified."
    );
};


workActivitySchema.pre(
    "save",
    function (next) {
        if (!this.isNew) {
            return next(
                new Error(
                    "WorkActivity is immutable and cannot be modified."
                )
            );
        }

        next();
    }
);


workActivitySchema.pre(
    [
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "replaceOne",
        "findOneAndReplace",
    ],
    function () {
        immutableOperationError();
    }
);


workActivitySchema.pre(
    [
        "deleteOne",
        "deleteMany",
        "findOneAndDelete",
        "findByIdAndDelete",
    ],
    function () {
        immutableOperationError();
    }
);


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "WorkActivity",
    workActivitySchema
);