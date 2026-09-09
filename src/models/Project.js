import mongoose from "mongoose";


// ============================================================
// PROJECT
// ============================================================
//
// A portfolio project. Editable inline from the public page by
// any authenticated admin. Soft-deleted via `archivedAt` so a
// removal can be undone.
// ============================================================


// A single block of the "manuscript" walkthrough: some
// screenshots plus the paragraphs explaining them.
const manuscriptBlockSchema = new mongoose.Schema(
    {
        images: {
            type: [String],
            default: [],
        },

        texts: {
            type: [String],
            default: [],
        },
    },
    { _id: false }
);


const notesSchema = new mongoose.Schema(
    {
        learned: { type: [String], default: [] },
        challenges: { type: [String], default: [] },
        technical: { type: [String], default: [] },
        reflection: { type: [String], default: [] },
    },
    { _id: false }
);


const projectSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },

        // URL-safe identifier, generated from the name. Stable
        // once set so links don't break when the name changes.
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        type: {
            type: String,
            trim: true,
            maxlength: 200,
            default: "",
        },

        description: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: "",
        },

        layout: {
            type: String,
            enum: ["portrait", "landscape"],
            default: "portrait",
        },

        status: {
            type: String,
            enum: ["complete", "incomplete", "planned"],
            default: "complete",
        },

        github: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },

        liveLink: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },

        demoLink: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },

        // Cover image URL.
        image: {
            type: String,
            trim: true,
            default: "",
        },

        technologies: {
            type: [String],
            default: [],
        },

        // Detail is rendered as EITHER the notes lists OR the
        // manuscript blocks, depending on which is populated.
        notes: {
            type: notesSchema,
            default: () => ({}),
        },

        descriptions: {
            type: [manuscriptBlockSchema],
            default: [],
        },

        // Manual sort order on the public page (ascending).
        order: {
            type: Number,
            default: 0,
        },

        // Soft delete. null = live.
        archivedAt: {
            type: Date,
            default: null,
        },

        // Audit trail: who last touched it.
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
// SLUG GENERATION
// ============================================================

const slugify = (value) =>
    String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "project";


projectSchema.pre("validate", async function () {
    if (this.slug) {
        return;
    }

    const base = slugify(this.name);
    let candidate = base;
    let suffix = 2;

    // eslint-disable-next-line no-await-in-loop
    while (
        await this.constructor.exists({ slug: candidate })
    ) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }

    this.slug = candidate;
});


// ============================================================
// INDEXES
// ============================================================

projectSchema.index({ archivedAt: 1, order: 1 });
projectSchema.index({ status: 1 });


export default mongoose.model("Project", projectSchema);
