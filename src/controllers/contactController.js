import mongoose from "mongoose";

import Message from "../models/Message.js";
import AuditLog from "../models/AuditLog.js";
import { recordContentChange } from "../utils/contentAudit.js";
import { sendContactMessage as sendContactEmail } from "../services/emailService.js";


// ============================================================
// SERIALIZER
// ============================================================

const serialize = (doc) => ({
  id: doc._id,
  name: doc.name,
  email: doc.email,
  subject: doc.subject,
  message: doc.message,
  status: doc.status,
  emailDelivered: doc.emailDelivered,
  archivedAt: doc.archivedAt,
  createdAt: doc.createdAt,
});

const clampString = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";


// ============================================================
// PUBLIC — SUBMIT A MESSAGE
// ============================================================
//
// POST /api/contact
//
// The message is saved to the inbox FIRST, then a Brevo email
// is sent as a notification. If the email fails the message is
// still kept (flagged `emailDelivered: false`) so nothing is
// lost. `company` is a honeypot — a real user never fills it.
// ============================================================

const sendContactMessage = async (req, res) => {
  try {
    const name = clampString(req.body.name, 200);
    const email = clampString(req.body.email, 320);
    const subject = clampString(req.body.subject, 300);
    const message = clampString(req.body.message, 8000);

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    // Honeypot — bots fill hidden fields; humans don't. Pretend
    // it worked so the bot doesn't retry.
    if (clampString(req.body.company, 100)) {
      return res.status(200).json({
        success: true,
        message: "Message sent successfully.",
      });
    }

    const record = await Message.create({
      name,
      email,
      subject,
      message,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    try {
      await sendContactEmail({ name, email, subject, message });
      record.emailDelivered = true;
      await record.save();
    } catch (emailError) {
      console.error(
        "Contact email error:",
        emailError.response?.body || emailError.message
      );
      // The message is safe in the inbox — don't fail the request.
    }

    return res.status(200).json({
      success: true,
      message: "Message sent successfully.",
    });
  } catch (error) {
    console.error("Contact submit error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to send message.",
    });
  }
};


// ============================================================
// ADMIN — LIST MESSAGES
// ============================================================
//
// GET /api/contact/messages
//   ?box=inbox|archived   (default inbox)
//   ?status=all|unread|read   (default all, inbox only)
//   ?q=search
//   ?page=1&limit=20
// ============================================================

const listMessages = async (req, res) => {
  try {
    const box =
      req.query.box === "archived" ? "archived" : "inbox";

    const filter = {
      archivedAt: box === "archived" ? { $ne: null } : null,
    };

    if (box === "inbox") {
      if (req.query.status === "unread") {
        filter.status = "unread";
      } else if (req.query.status === "read") {
        filter.status = "read";
      }
    }

    const q = clampString(req.query.q, 120);
    if (q) {
      const rx = new RegExp(
        q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [
        { name: rx },
        { email: rx },
        { subject: rx },
        { message: rx },
      ];
    }

    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1
    );
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 20)
    );

    const [messages, total, unread] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Message.countDocuments(filter),
      Message.countDocuments({
        archivedAt: null,
        status: "unread",
      }),
    ]);

    return res.json({
      success: true,
      data: {
        messages: messages.map(serialize),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        unread,
      },
    });
  } catch (error) {
    console.error("List messages error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load messages.",
    });
  }
};


// ============================================================
// ADMIN — UNREAD COUNT  (sidebar badge)
// ============================================================
//
// GET /api/contact/messages/unread-count
// ============================================================

const unreadCount = async (req, res) => {
  try {
    const count = await Message.countDocuments({
      archivedAt: null,
      status: "unread",
    });

    return res.json({ success: true, data: { count } });
  } catch (error) {
    console.error("Unread count error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load unread count.",
    });
  }
};


// ============================================================
// ADMIN — SET STATUS (read / unread)
// ============================================================
//
// PATCH /api/contact/messages/:id   Body: { status }
// ============================================================

const setMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message reference.",
      });
    }

    const status =
      req.body.status === "unread" ? "unread" : "read";

    const message = await Message.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    return res.json({
      success: true,
      data: { message: serialize(message) },
    });
  } catch (error) {
    console.error("Set message status error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update the message.",
    });
  }
};


// ============================================================
// ADMIN — ARCHIVE / RESTORE
// ============================================================

const archiveMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (!message.archivedAt) {
      message.archivedAt = new Date();
      await message.save();

      await recordContentChange({
        req,
        action: "DELETE",
        resource: "MESSAGE",
        resourceId: message._id,
        resourceName: `${message.name} — ${message.subject}`,
      });
    }

    return res.json({
      success: true,
      data: { message: serialize(message) },
    });
  } catch (error) {
    console.error("Archive message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to archive the message.",
    });
  }
};


const restoreMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (message.archivedAt) {
      message.archivedAt = null;
      await message.save();

      await recordContentChange({
        req,
        action: "UPDATE",
        resource: "MESSAGE",
        resourceId: message._id,
        resourceName: `${message.name} — ${message.subject}`,
        changes: [
          {
            field: "archivedAt",
            before: "archived",
            after: "restored",
          },
        ],
      });
    }

    return res.json({
      success: true,
      data: { message: serialize(message) },
    });
  } catch (error) {
    console.error("Restore message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to restore the message.",
    });
  }
};


// ============================================================
// ADMIN — PERMANENT DELETE
// ============================================================
//
// DELETE /api/contact/messages/:id
// ============================================================

const deleteMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    await message.deleteOne();

    try {
      await AuditLog.create({
        admin: req.user._id,
        action: "DELETE",
        resource: "MESSAGE",
        resourceId: message._id,
        description: `Permanently deleted message from ${message.name} "${message.subject}"`.slice(
          0,
          500
        ),
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        metadata: {
          resourceName: `${message.name} — ${message.subject}`,
          email: message.email,
        },
      });
    } catch (auditError) {
      console.error(
        "Message delete audit failed:",
        auditError.message
      );
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Delete message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to delete the message.",
    });
  }
};


export {
  sendContactMessage,
  listMessages,
  unreadCount,
  setMessageStatus,
  archiveMessage,
  restoreMessage,
  deleteMessage,
};
