import mongoose from "mongoose";

const workSchema = new mongoose.Schema(
    {
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
        // WORK STATUS
        // ============================================================

        status: {
            type: String,
            enum: [
                "IN_PROGRESS",
                "COMPLETED",
                "ARCHIVED",
            ],
            default: "IN_PROGRESS",
            required: true,
        },

        /*
         * Locking is intentionally separate from completion.
         *
         * Examples:
         *
         * IN_PROGRESS + unlocked
         * IN_PROGRESS + locked
         * COMPLETED + unlocked
         * COMPLETED + locked
         * ARCHIVED
         */
        isLocked: {
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
        // OWNERSHIP
        // ============================================================

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
            immutable: true,
        },

        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true,
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
        },


        // ============================================================
        // PARTICIPANTS
        // ============================================================

        participants: [
            {
                admin: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Admin",
                    required: true,
                },

                addedBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Admin",
                    required: true,
                },

                addedAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],


        // ============================================================
        // ACCESS / SECURITY CONFIGURATION
        // ============================================================

        /*
         * Work-level access configuration.
         *
         * OPEN_VIEW:
         *      Normal Work access allows viewing.
         *
         * PASSWORD_PROTECTED:
         *      Additional Work password may be required
         *      for protected functionality.
         *
         * COLLABORATIVE:
         *      Authorized admins can actively contribute.
         *
         * This does NOT replace normal admin authentication.
         */
        accessMode: {
            type: String,
            enum: [
                "OPEN_VIEW",
                "PASSWORD_PROTECTED",
                "COLLABORATIVE",
            ],
            default: "COLLABORATIVE",
            required: true,
        },

        /*
         * Store only a hash.
         *
         * Never store the Work password as plaintext.
         *
         * The controller/service layer will be responsible
         * for hashing and verifying this value.
         */
        passwordHash: {
            type: String,
            default: null,
            select: false,
        },

        /*
         * Allows the application to determine whether a password
         * has actually been configured without exposing passwordHash.
         */
        passwordEnabled: {
            type: Boolean,
            default: false,
            required: true,
        },


        // ============================================================
        // ARCHIVE INFORMATION
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
        // LOCK INFORMATION
        // ============================================================

        lockedAt: {
            type: Date,
            default: null,
        },

        lockedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
        },


        // ============================================================
        // OWNERSHIP / LIFECYCLE METADATA
        // ============================================================

        ownershipTransferredAt: {
            type: Date,
            default: null,
        },

        ownershipTransferredBy: {
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

workSchema.index({
    status: 1,
    order: 1,
});

workSchema.index({
    createdBy: 1,
});

workSchema.index({
    owner: 1,
});

workSchema.index({
    "participants.admin": 1,
});

workSchema.index({
    status: 1,
    isLocked: 1,
});


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "Work",
    workSchema
);