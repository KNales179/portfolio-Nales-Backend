import mongoose from "mongoose";


// ============================================================
// MESSAGE
// ============================================================
//
// A message left through the public contact form. Stored so it
// shows up in the admin "Messages" inbox; the Brevo email is
// still sent as a notification. `emailDelivered` records whether
// that notification went out. Soft-deleted via `archivedAt`;
// a permanent delete is a separate admin action.
// ============================================================

const messageSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },

        email: {
            type: String,
            required: true,
            trim: true,
            maxlength: 320,
        },

        subject: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300,
        },

        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 8000,
        },

        // "unread" → "read" once opened in the inbox.
        status: {
            type: String,
            enum: ["unread", "read"],
            default: "unread",
        },

        // Whether the Brevo notification email was sent.
        emailDelivered: {
            type: Boolean,
            default: false,
        },

        // Soft delete. null = in the inbox.
        archivedAt: {
            type: Date,
            default: null,
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


messageSchema.index({ archivedAt: 1, createdAt: -1 });
messageSchema.index({ status: 1 });


export default mongoose.model("Message", messageSchema);
