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
// The enum is kept open-ended so later phases (Play presets,
// etc.) can add types without a migration.
//
//   PAGE_VIEW / PAGE_EXIT  — Phase 1 (page analytics)
//   INTERACTION            — Phase 2 (interaction analytics);
//                            the specific action is in `action`
// ============================================================

export const ANALYTICS_EVENT_TYPES = [
    "PAGE_VIEW",
    "PAGE_EXIT",
    "INTERACTION",
];


// ============================================================
// INTERACTION ACTIONS
// ============================================================
//
// The allowlist of `action` values accepted on INTERACTION
// events. Anything not in this list is dropped at ingestion.
// ============================================================

export const ANALYTICS_INTERACTION_ACTIONS = [
    "NAV_CLICK",
    "PROJECT_OPENED",
    "RESUME_DOWNLOAD",
    "EMAIL_CLICK",
    "GITHUB_CLICK",
    "EXTERNAL_LINK_CLICK",
    "CONTACT_FORM_OPENED",
    "CONTACT_FORM_SUBMITTED",
    "SCROLL_DEPTH",
    "COPY",
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
        // INTERACTION (INTERACTION events only)
        // ----------------------------------------------------

        // The specific interaction, e.g. "PROJECT_OPENED".
        // Validated against ANALYTICS_INTERACTION_ACTIONS.
        action: {
            type: String,
            enum: [
                ...ANALYTICS_INTERACTION_ACTIONS,
                null,
            ],
            default: null,
            immutable: true,
        },

        // Free-form subject of the interaction, e.g. a project
        // title, an external domain, a nav destination, or a
        // scroll-depth bucket ("50"). Never contains anything
        // that identifies a visitor.
        target: {
            type: String,
            default: null,
            trim: true,
            maxlength: 300,
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

        // Visitor viewport size at the time of the event
        // (client-reported). Used for the screen-size breakdown.
        screen: {
            type: new mongoose.Schema(
                {
                    w: { type: Number, default: null },
                    h: { type: Number, default: null },
                },
                { _id: false }
            ),
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

analyticsEventSchema.index({
    type: 1,
    action: 1,
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
