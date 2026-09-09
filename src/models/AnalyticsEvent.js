import mongoose from "mongoose";


// ============================================================
// ANALYTICS EVENT
// ============================================================
//
// Anonymous, append-only visitor analytics.
//
// The portfolio frontend emits small events (page views, page
// exits, and — in later phases — interactions). The backend
// enriches each event with server-derived context (device, geo)
// and stores it here.
//
// PRIVACY
// -------
// - No visitor accounts. No names. No emails.
// - `sessionId` / `visitorHash` are anonymous identifiers used
//   only to group a visit and estimate unique/returning traffic.
// - Raw IP + user agent are stored for the private admin
//   dashboard (same as WorkActivity already does). They must
//   never be exposed through any public analytics endpoint.
// ============================================================


// ============================================================
// EVENT TYPES
// ============================================================
//
// Phase 1 only writes PAGE_VIEW / PAGE_EXIT. The enum is kept
// open-ended so later phases (interactions, Play presets, etc.)
// can add types without a migration.
// ============================================================

export const ANALYTICS_EVENT_TYPES = [
    "PAGE_VIEW",
    "PAGE_EXIT",
];


// ============================================================
// SUB-SCHEMAS
// ============================================================

const deviceSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: [
                "mobile",
                "tablet",
                "desktop",
                "unknown",
            ],
            default: "unknown",
        },

        browser: {
            type: String,
            default: null,
        },

        os: {
            type: String,
            default: null,
        },
    },
    {
        _id: false,
    }
);


const geoSchema = new mongoose.Schema(
    {
        country: {
            type: String,
            default: null,
        },

        countryCode: {
            type: String,
            default: null,
        },

        region: {
            type: String,
            default: null,
        },

        city: {
            type: String,
            default: null,
        },
    },
    {
        _id: false,
    }
);


// ============================================================
// SCHEMA
// ============================================================

const analyticsEventSchema = new mongoose.Schema(
    {
        // ----------------------------------------------------
        // EVENT
        // ----------------------------------------------------

        type: {
            type: String,
            enum: ANALYTICS_EVENT_TYPES,
            required: true,
            immutable: true,
        },


        // ----------------------------------------------------
        // ANONYMOUS IDENTIFIERS
        // ----------------------------------------------------

        // Client-generated, lives in sessionStorage. Groups the
        // events of a single visit.
        sessionId: {
            type: String,
            required: true,
            immutable: true,
        },

        // Server-derived: hash(ip + userAgent). Stable across
        // visits, used to estimate unique / returning visitors
        // without storing anything that identifies a person.
        visitorHash: {
            type: String,
            default: null,
            immutable: true,
        },


        // ----------------------------------------------------
        // PAGE
        // ----------------------------------------------------

        // Normalized route path, e.g. "/", "/projects", "/about".
        path: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300,
            immutable: true,
        },

        // External referrer for the first view of a session.
        referrer: {
            type: String,
            default: null,
            maxlength: 500,
            immutable: true,
        },

        // Time spent on the page, in milliseconds. Set on
        // PAGE_EXIT only.
        durationMs: {
            type: Number,
            default: null,
            min: 0,
            immutable: true,
        },


        // ----------------------------------------------------
        // SERVER-DERIVED CONTEXT
        // ----------------------------------------------------

        device: {
            type: deviceSchema,
            default: () => ({}),
            immutable: true,
        },

        geo: {
            type: geoSchema,
            default: () => ({}),
            immutable: true,
        },


        // ----------------------------------------------------
        // REQUEST CONTEXT (private — admin dashboard only)
        // ----------------------------------------------------

        ipAddress: {
            type: String,
            default: null,
            immutable: true,
        },

        userAgent: {
            type: String,
            default: null,
            maxlength: 600,
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

analyticsEventSchema.index({
    type: 1,
    createdAt: -1,
});

analyticsEventSchema.index({
    path: 1,
    createdAt: -1,
});

analyticsEventSchema.index({
    sessionId: 1,
    createdAt: -1,
});

analyticsEventSchema.index({
    visitorHash: 1,
    createdAt: -1,
});


// ============================================================
// IMMUTABILITY PROTECTION
// ============================================================
//
// Analytics events are append-only. Application code should
// never update or delete them individually. (Retention cleanup,
// if added later, should be a deliberate maintenance job.)
// ============================================================

const immutableOperationError = () => {
    throw new Error(
        "AnalyticsEvent is immutable and cannot be modified."
    );
};


analyticsEventSchema.pre(
    "save",
    function () {
        if (!this.isNew) {
            throw new Error(
                "AnalyticsEvent is immutable and cannot be modified."
            );
        }
    }
);


analyticsEventSchema.pre(
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


// ============================================================
// MODEL
// ============================================================

export default mongoose.model(
    "AnalyticsEvent",
    analyticsEventSchema
);
