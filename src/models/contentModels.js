import mongoose from "mongoose";


// ============================================================
// PORTFOLIO CONTENT MODELS
// ============================================================
//
// The small "list of records" content types, plus the keyed
// singleton for section headers (hero, about). All list models
// share order / archivedAt / updatedBy and are driven by the
// contentCollection factory.
// ============================================================

const listBase = {
    order: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        default: null,
    },
};

const listOptions = { timestamps: true };

const model = (name, fields) =>
    mongoose.model(
        name,
        new mongoose.Schema(
            { ...fields, ...listBase },
            listOptions
        )
    );


// ------------------------------------------------------------
// SKILL GROUP  — e.g. "Languages": [TypeScript, JavaScript, ...]
// ------------------------------------------------------------

export const Skill = model("Skill", {
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
    },
    icon: { type: String, default: "Code2", trim: true },
    items: { type: [String], default: [] },
});


// ------------------------------------------------------------
// JOURNEY MILESTONE
// ------------------------------------------------------------

export const JourneyMilestone = model("JourneyMilestone", {
    year: { type: String, default: "", trim: true, maxlength: 20 },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 2000,
    },
});


// ------------------------------------------------------------
// AWARD
// ------------------------------------------------------------

export const Award = model("Award", {
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    category: {
        type: String,
        default: "",
        trim: true,
        maxlength: 120,
    },
    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 2000,
    },
    icon: { type: String, default: "Award", trim: true },
});


// ------------------------------------------------------------
// HOBBY
// ------------------------------------------------------------

export const Hobby = model("Hobby", {
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 2000,
    },
});


// ------------------------------------------------------------
// CERTIFICATE
// ------------------------------------------------------------

export const Certificate = model("Certificate", {
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    issuer: {
        type: String,
        default: "",
        trim: true,
        maxlength: 150,
    },
    verifyUrl: {
        type: String,
        default: "",
        trim: true,
        maxlength: 500,
    },
    image: { type: String, default: "", trim: true },
});


// ------------------------------------------------------------
// CONTACT LINK
// ------------------------------------------------------------

export const ContactLink = model("ContactLink", {
    label: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80,
    },
    value: {
        type: String,
        default: "",
        trim: true,
        maxlength: 200,
    },
    href: {
        type: String,
        default: "",
        trim: true,
        maxlength: 500,
    },
    icon: { type: String, default: "Link", trim: true },
    external: { type: Boolean, default: false },
    download: { type: Boolean, default: false },
});


// ------------------------------------------------------------
// STRENGTH  (About section)
// ------------------------------------------------------------

export const Strength = model("Strength", {
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
    },
    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 1000,
    },
    icon: { type: String, default: "Sparkles", trim: true },
});


// ------------------------------------------------------------
// SITE TEXT  — keyed singleton for section headers
//   key "hero"  -> { greeting, name, role, description }
//   key "about" -> { label, title, description }
// ------------------------------------------------------------

export const SiteText = mongoose.model(
    "SiteText",
    new mongoose.Schema(
        {
            key: {
                type: String,
                required: true,
                unique: true,
                trim: true,
            },
            values: {
                type: mongoose.Schema.Types.Mixed,
                default: {},
            },
            // Cloudinary public IDs for binary assets attached to
            // this key (e.g. { resume: "portfolio/documents/xyz" }).
            // Never returned to the public site.
            assets: {
                type: mongoose.Schema.Types.Mixed,
                default: {},
            },
            updatedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Admin",
                default: null,
            },
        },
        { timestamps: true }
    )
);
