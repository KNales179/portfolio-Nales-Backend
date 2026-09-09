import AnalyticsEvent, {
    ANALYTICS_EVENT_TYPES,
    ANALYTICS_INTERACTION_ACTIONS,
} from "../models/AnalyticsEvent.js";

import { getIpLocation } from "../utils/geoIp.js";

import {
    parseDevice,
    buildVisitorHash,
    getClientIp,
} from "../utils/deviceInfo.js";


// ============================================================
// CONFIG
// ============================================================

const MAX_EVENTS_PER_BATCH = 50;

// A single page visit longer than this is almost certainly a
// backgrounded tab — clamp it so it does not distort averages.
const MAX_DURATION_MS = 30 * 60 * 1000;

const VALID_PERIODS = [
    "today",
    "7d",
    "30d",
    "year",
];


// ============================================================
// HELPERS
// ============================================================

const isNonEmptyString = (value) =>
    typeof value === "string" &&
    value.trim().length > 0;


// A path is trackable only if it is a site-relative route that
// is NOT part of the private admin area. The frontend already
// filters these out; this is defense in depth.
const isPublicPath = (path) => {
    if (!isNonEmptyString(path)) {
        return false;
    }

    if (!path.startsWith("/")) {
        return false;
    }

    if (path.length > 300) {
        return false;
    }

    const lower = path.toLowerCase();

    if (
        lower === "/login" ||
        lower === "/admin" ||
        lower.startsWith("/admin/")
    ) {
        return false;
    }

    return true;
};


const normalizeDuration = (value) => {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return null;
    }

    return Math.min(
        Math.round(number),
        MAX_DURATION_MS
    );
};


const normalizeDimension = (value) => {
    const number = Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0 ||
        number > 20000
    ) {
        return null;
    }

    return Math.round(number);
};


const normalizeScreen = (screen) => {
    if (!screen || typeof screen !== "object") {
        return {};
    }

    return {
        w: normalizeDimension(screen.w),
        h: normalizeDimension(screen.h),
    };
};


// period -> { start, end, granularity }
const resolvePeriod = (rawPeriod) => {
    const period = VALID_PERIODS.includes(rawPeriod)
        ? rawPeriod
        : "7d";

    const end = new Date();
    const start = new Date(end);

    let granularity = "day";

    if (period === "today") {
        start.setUTCHours(0, 0, 0, 0);
        granularity = "hour";
    } else if (period === "7d") {
        start.setUTCDate(start.getUTCDate() - 7);
        granularity = "day";
    } else if (period === "30d") {
        start.setUTCDate(start.getUTCDate() - 30);
        granularity = "day";
    } else if (period === "year") {
        start.setUTCFullYear(start.getUTCFullYear() - 1);
        granularity = "month";
    }

    return {
        period,
        start,
        end,
        granularity,
    };
};


// Produce a gap-free series so charts render a continuous axis.
const buildContiguousSeries = (
    rows,
    start,
    end,
    granularity
) => {
    const counts = new Map();

    for (const row of rows) {
        counts.set(
            new Date(row._id).toISOString(),
            row.views
        );
    }

    const series = [];

    const cursor = new Date(start);
    cursor.setUTCMilliseconds(0);
    cursor.setUTCSeconds(0);

    if (granularity === "hour") {
        cursor.setUTCMinutes(0);
    } else {
        cursor.setUTCMinutes(0);
        cursor.setUTCHours(0);
    }

    if (granularity === "month") {
        cursor.setUTCDate(1);
    }

    let guard = 0;

    while (cursor <= end && guard < 1000) {
        const key = cursor.toISOString();

        series.push({
            date: key,
            views: counts.get(key) || 0,
        });

        if (granularity === "hour") {
            cursor.setUTCHours(cursor.getUTCHours() + 1);
        } else if (granularity === "month") {
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        } else {
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        guard += 1;
    }

    return series;
};


// Ordered list of ISO bucket-start keys for a period. Lets a
// caller merge several metrics onto one gap-free time axis.
const bucketKeys = (start, end, granularity) => {
    const keys = [];

    const cursor = new Date(start);
    cursor.setUTCMilliseconds(0);
    cursor.setUTCSeconds(0);
    cursor.setUTCMinutes(0);

    if (granularity !== "hour") {
        cursor.setUTCHours(0);
    }

    if (granularity === "month") {
        cursor.setUTCDate(1);
    }

    let guard = 0;

    while (cursor <= end && guard < 1000) {
        keys.push(cursor.toISOString());

        if (granularity === "hour") {
            cursor.setUTCHours(cursor.getUTCHours() + 1);
        } else if (granularity === "month") {
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        } else {
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        guard += 1;
    }

    return keys;
};


// ============================================================
// COLLECT EVENTS  (public)
// ============================================================
//
// POST /api/analytics/collect
// Body: { events: [{ type, sessionId, path, referrer?, durationMs? }] }
// ============================================================

export const collectEvents = async (req, res) => {
    try {
        const events = req.body?.events;

        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No analytics events provided.",
            });
        }

        const ip = getClientIp(req);
        const userAgent =
            req.headers["user-agent"] || null;

        // Enrich once per request, not per event.
        const [geoResult, device] = await Promise.all([
            getIpLocation(ip),
            Promise.resolve(parseDevice(userAgent)),
        ]);

        const geo = geoResult
            ? {
                country: geoResult.country || null,
                countryCode: geoResult.countryCode || null,
                region: geoResult.region || null,
                city: geoResult.city || null,
            }
            : {};

        const visitorHash = buildVisitorHash(
            ip,
            userAgent
        );

        const documents = [];

        for (const event of events.slice(
            0,
            MAX_EVENTS_PER_BATCH
        )) {
            if (
                !event ||
                !ANALYTICS_EVENT_TYPES.includes(event.type)
            ) {
                continue;
            }

            if (!isPublicPath(event.path)) {
                continue;
            }

            if (
                !isNonEmptyString(event.sessionId) ||
                event.sessionId.length > 100
            ) {
                continue;
            }

            const referrer =
                isNonEmptyString(event.referrer) &&
                event.referrer.length <= 500
                    ? event.referrer.trim()
                    : null;

            const durationMs =
                event.type === "PAGE_EXIT"
                    ? normalizeDuration(event.durationMs)
                    : null;

            // Interaction events must carry an allowlisted
            // action; everything else is dropped.
            let action = null;
            let target = null;

            if (event.type === "INTERACTION") {
                if (
                    !ANALYTICS_INTERACTION_ACTIONS.includes(
                        event.action
                    )
                ) {
                    continue;
                }

                action = event.action;

                target = isNonEmptyString(event.target)
                    ? event.target.trim().slice(0, 300)
                    : null;
            }

            const screen = normalizeScreen(event.screen);

            documents.push({
                type: event.type,
                sessionId: event.sessionId.trim(),
                visitorHash,
                path: event.path.trim(),
                referrer,
                durationMs,
                action,
                target,
                device,
                screen,
                geo,
                ipAddress: ip || null,
                userAgent: userAgent
                    ? String(userAgent).slice(0, 600)
                    : null,
            });
        }

        if (documents.length === 0) {
            return res.status(202).json({
                success: true,
                accepted: 0,
            });
        }

        await AnalyticsEvent.insertMany(documents, {
            ordered: false,
        });

        return res.status(202).json({
            success: true,
            accepted: documents.length,
        });
    } catch (error) {
        console.error(
            "Analytics collect error:",
            error.message
        );

        // Never make the visitor's browser retry aggressively
        // over an analytics failure.
        return res.status(202).json({
            success: true,
            accepted: 0,
        });
    }
};


// ============================================================
// PAGE ANALYTICS  (admin)
// ============================================================
//
// GET /api/analytics/pages?period=today|7d|30d|year
// ============================================================

export const getPageAnalytics = async (req, res) => {
    try {
        const { period, start, end, granularity } =
            resolvePeriod(req.query.period);

        const [result] = await AnalyticsEvent.aggregate([
            {
                $match: {
                    type: {
                        $in: ["PAGE_VIEW", "PAGE_EXIT"],
                    },
                    createdAt: {
                        $gte: start,
                        $lte: end,
                    },
                },
            },
            {
                $facet: {
                    // ------------------------------------
                    // PER-PAGE VIEW COUNTS
                    // ------------------------------------
                    pages: [
                        {
                            $match: { type: "PAGE_VIEW" },
                        },
                        {
                            $group: {
                                _id: "$path",
                                views: { $sum: 1 },
                                sessions: {
                                    $addToSet: "$sessionId",
                                },
                                visitors: {
                                    $addToSet: "$visitorHash",
                                },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                path: "$_id",
                                views: 1,
                                uniqueSessions: {
                                    $size: "$sessions",
                                },
                                uniqueVisitors: {
                                    $size: {
                                        $setDifference: [
                                            "$visitors",
                                            [null],
                                        ],
                                    },
                                },
                            },
                        },
                        { $sort: { views: -1 } },
                    ],

                    // ------------------------------------
                    // PER-PAGE TIME ON PAGE
                    // ------------------------------------
                    durations: [
                        {
                            $match: {
                                type: "PAGE_EXIT",
                                durationMs: { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: "$path",
                                avgDurationMs: {
                                    $avg: "$durationMs",
                                },
                                totalDurationMs: {
                                    $sum: "$durationMs",
                                },
                            },
                        },
                    ],

                    // ------------------------------------
                    // TOTALS
                    // ------------------------------------
                    totalViews: [
                        {
                            $match: { type: "PAGE_VIEW" },
                        },
                        { $count: "value" },
                    ],
                    uniqueVisitors: [
                        {
                            $match: { type: "PAGE_VIEW" },
                        },
                        {
                            $group: {
                                _id: null,
                                visitors: {
                                    $addToSet: "$visitorHash",
                                },
                            },
                        },
                        {
                            $project: {
                                value: {
                                    $size: {
                                        $setDifference: [
                                            "$visitors",
                                            [null],
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                    uniqueSessions: [
                        {
                            $match: { type: "PAGE_VIEW" },
                        },
                        {
                            $group: {
                                _id: null,
                                sessions: {
                                    $addToSet: "$sessionId",
                                },
                            },
                        },
                        {
                            $project: {
                                value: {
                                    $size: "$sessions",
                                },
                            },
                        },
                    ],
                    avgDuration: [
                        {
                            $match: {
                                type: "PAGE_EXIT",
                                durationMs: { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: null,
                                value: {
                                    $avg: "$durationMs",
                                },
                            },
                        },
                    ],

                    // ------------------------------------
                    // TIME SERIES
                    // ------------------------------------
                    series: [
                        {
                            $match: { type: "PAGE_VIEW" },
                        },
                        {
                            $group: {
                                _id: {
                                    $dateTrunc: {
                                        date: "$createdAt",
                                        unit: granularity,
                                    },
                                },
                                views: { $sum: 1 },
                            },
                        },
                        { $sort: { _id: 1 } },
                    ],
                },
            },
        ]);

        // ----------------------------------------------------
        // MERGE PAGE VIEWS + DURATIONS
        // ----------------------------------------------------

        const durationByPath = new Map(
            (result.durations || []).map((row) => [
                row._id,
                row,
            ])
        );

        const pages = (result.pages || []).map((page) => {
            const duration = durationByPath.get(page.path);

            return {
                path: page.path,
                views: page.views,
                uniqueVisitors: page.uniqueVisitors,
                uniqueSessions: page.uniqueSessions,
                avgDurationMs: duration
                    ? Math.round(duration.avgDurationMs)
                    : null,
                totalDurationMs: duration
                    ? Math.round(duration.totalDurationMs)
                    : 0,
            };
        });

        const totals = {
            views:
                result.totalViews?.[0]?.value || 0,
            uniqueVisitors:
                result.uniqueVisitors?.[0]?.value || 0,
            uniqueSessions:
                result.uniqueSessions?.[0]?.value || 0,
            avgDurationMs: result.avgDuration?.[0]?.value
                ? Math.round(result.avgDuration[0].value)
                : null,
        };

        const series = buildContiguousSeries(
            result.series || [],
            start,
            end,
            granularity
        );

        return res.status(200).json({
            success: true,
            data: {
                period,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                granularity,
                totals,
                pages,
                series,
            },
        });
    } catch (error) {
        console.error(
            "Page analytics error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load page analytics.",
        });
    }
};


// ============================================================
// INTERACTION ANALYTICS  (admin)
// ============================================================
//
// GET /api/analytics/interactions?period=today|7d|30d|year
// ============================================================

const TOP_TARGETS_PER_ACTION = 8;

export const getInteractionAnalytics = async (req, res) => {
    try {
        const { period, start, end, granularity } =
            resolvePeriod(req.query.period);

        const [result] = await AnalyticsEvent.aggregate([
            {
                $match: {
                    type: "INTERACTION",
                    createdAt: {
                        $gte: start,
                        $lte: end,
                    },
                },
            },
            {
                $facet: {
                    total: [{ $count: "value" }],

                    byAction: [
                        {
                            $group: {
                                _id: "$action",
                                count: { $sum: 1 },
                            },
                        },
                        { $sort: { count: -1 } },
                    ],

                    byPage: [
                        {
                            $group: {
                                _id: "$path",
                                count: { $sum: 1 },
                            },
                        },
                        { $sort: { count: -1 } },
                        { $limit: 20 },
                    ],

                    targets: [
                        {
                            $match: {
                                target: { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: {
                                    action: "$action",
                                    target: "$target",
                                },
                                count: { $sum: 1 },
                            },
                        },
                        { $sort: { count: -1 } },
                    ],

                    series: [
                        {
                            $group: {
                                _id: {
                                    $dateTrunc: {
                                        date: "$createdAt",
                                        unit: granularity,
                                    },
                                },
                                views: { $sum: 1 },
                            },
                        },
                        { $sort: { _id: 1 } },
                    ],
                },
            },
        ]);

        // ----------------------------------------------------
        // BY ACTION
        // ----------------------------------------------------

        const byAction = (result.byAction || [])
            .filter((row) => row._id)
            .map((row) => ({
                action: row._id,
                count: row.count,
            }));

        // ----------------------------------------------------
        // BY PAGE
        // ----------------------------------------------------

        const byPage = (result.byPage || [])
            .filter((row) => row._id)
            .map((row) => ({
                path: row._id,
                count: row.count,
            }));

        // ----------------------------------------------------
        // TOP TARGETS, GROUPED BY ACTION
        // ----------------------------------------------------

        const topTargets = {};

        for (const row of result.targets || []) {
            const action = row._id?.action;
            const target = row._id?.target;

            if (!action || !target) {
                continue;
            }

            if (!topTargets[action]) {
                topTargets[action] = [];
            }

            if (
                topTargets[action].length <
                TOP_TARGETS_PER_ACTION
            ) {
                topTargets[action].push({
                    target,
                    count: row.count,
                });
            }
        }

        // ----------------------------------------------------
        // TOTALS + SERIES
        // ----------------------------------------------------

        const totals = {
            interactions: result.total?.[0]?.value || 0,
            mostInteractedPage: byPage[0]?.path || null,
        };

        const series = buildContiguousSeries(
            result.series || [],
            start,
            end,
            granularity
        ).map((point) => ({
            date: point.date,
            interactions: point.views,
        }));

        return res.status(200).json({
            success: true,
            data: {
                period,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                granularity,
                totals,
                byAction,
                byPage,
                topTargets,
                series,
            },
        });
    } catch (error) {
        console.error(
            "Interaction analytics error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to load interaction analytics.",
        });
    }
};


// ============================================================
// AUDIENCE ANALYTICS  (admin)
// ============================================================
//
// GET /api/analytics/audience?period=today|7d|30d|year
//
// Device / browser / OS / screen-size / location breakdowns.
// Everything here is derived from context already attached to
// each event at ingestion — no extra tracking is involved.
// ============================================================

// Viewport-width buckets. Boundaries must be ascending and the
// last one is an open upper bound.
const SCREEN_BUCKETS = [
    { max: 640, label: "Small (< 640)" },
    { max: 1024, label: "Medium (640–1024)" },
    { max: 1440, label: "Large (1024–1440)" },
    { max: Infinity, label: "X-Large (≥ 1440)" },
];

const screenBucketLabel = (width) => {
    for (const bucket of SCREEN_BUCKETS) {
        if (width < bucket.max) {
            return bucket.label;
        }
    }

    return SCREEN_BUCKETS[SCREEN_BUCKETS.length - 1].label;
};


export const getAudienceAnalytics = async (req, res) => {
    try {
        const { period, start, end } = resolvePeriod(
            req.query.period
        );

        // One row per page view keeps every breakdown on the
        // same denominator.
        const [result] = await AnalyticsEvent.aggregate([
            {
                $match: {
                    type: "PAGE_VIEW",
                    createdAt: {
                        $gte: start,
                        $lte: end,
                    },
                },
            },
            {
                $facet: {
                    totalViews: [{ $count: "value" }],

                    visitors: [
                        {
                            $group: {
                                _id: null,
                                v: {
                                    $addToSet: "$visitorHash",
                                },
                            },
                        },
                        {
                            $project: {
                                value: {
                                    $size: {
                                        $setDifference: [
                                            "$v",
                                            [null],
                                        ],
                                    },
                                },
                            },
                        },
                    ],

                    devices: [
                        {
                            $group: {
                                _id: "$device.type",
                                views: { $sum: 1 },
                                visitors: {
                                    $addToSet: "$visitorHash",
                                },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                type: {
                                    $ifNull: [
                                        "$_id",
                                        "unknown",
                                    ],
                                },
                                views: 1,
                                visitors: {
                                    $size: {
                                        $setDifference: [
                                            "$visitors",
                                            [null],
                                        ],
                                    },
                                },
                            },
                        },
                        { $sort: { views: -1 } },
                    ],

                    browsers: [
                        {
                            $match: {
                                "device.browser": {
                                    $ne: null,
                                },
                            },
                        },
                        {
                            $group: {
                                _id: "$device.browser",
                                views: { $sum: 1 },
                            },
                        },
                        { $sort: { views: -1 } },
                        { $limit: 8 },
                    ],

                    os: [
                        {
                            $match: {
                                "device.os": { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: "$device.os",
                                views: { $sum: 1 },
                            },
                        },
                        { $sort: { views: -1 } },
                        { $limit: 8 },
                    ],

                    screens: [
                        {
                            $match: {
                                "screen.w": { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: "$screen.w",
                                views: { $sum: 1 },
                            },
                        },
                    ],

                    countries: [
                        {
                            $match: {
                                "geo.country": { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: {
                                    country: "$geo.country",
                                    code: "$geo.countryCode",
                                },
                                views: { $sum: 1 },
                                visitors: {
                                    $addToSet: "$visitorHash",
                                },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                country: "$_id.country",
                                countryCode: "$_id.code",
                                views: 1,
                                visitors: {
                                    $size: {
                                        $setDifference: [
                                            "$visitors",
                                            [null],
                                        ],
                                    },
                                },
                            },
                        },
                        { $sort: { views: -1 } },
                        { $limit: 12 },
                    ],

                    cities: [
                        {
                            $match: {
                                "geo.city": { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: {
                                    city: "$geo.city",
                                    country: "$geo.country",
                                },
                                views: { $sum: 1 },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                city: "$_id.city",
                                country: "$_id.country",
                                views: 1,
                            },
                        },
                        { $sort: { views: -1 } },
                        { $limit: 10 },
                    ],

                    geoCoverage: [
                        {
                            $group: {
                                _id: null,
                                total: { $sum: 1 },
                                withGeo: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $ne: [
                                                    "$geo.country",
                                                    null,
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        ]);

        // ----------------------------------------------------
        // SCREEN BUCKETS
        // ----------------------------------------------------

        const screenTotals = new Map();

        for (const row of result.screens || []) {
            const label = screenBucketLabel(row._id);

            screenTotals.set(
                label,
                (screenTotals.get(label) || 0) + row.views
            );
        }

        const screens = SCREEN_BUCKETS.map(
            (bucket) => ({
                label: bucket.label,
                views: screenTotals.get(bucket.label) || 0,
            })
        ).filter((row) => row.views > 0);

        // ----------------------------------------------------
        // GEO COVERAGE
        // ----------------------------------------------------

        const coverage = result.geoCoverage?.[0] || {
            total: 0,
            withGeo: 0,
        };

        const geoCoveragePct =
            coverage.total > 0
                ? Math.round(
                      (coverage.withGeo / coverage.total) *
                          100
                  )
                : 0;

        return res.status(200).json({
            success: true,
            data: {
                period,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                totals: {
                    views:
                        result.totalViews?.[0]?.value || 0,
                    visitors:
                        result.visitors?.[0]?.value || 0,
                    geoCoveragePct,
                },
                devices: result.devices || [],
                browsers: (result.browsers || []).map(
                    (row) => ({
                        name: row._id,
                        views: row.views,
                    })
                ),
                os: (result.os || []).map((row) => ({
                    name: row._id,
                    views: row.views,
                })),
                screens,
                countries: result.countries || [],
                cities: result.cities || [],
            },
        });
    } catch (error) {
        console.error(
            "Audience analytics error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load audience analytics.",
        });
    }
};


// ============================================================
// VISITOR ANALYTICS  (admin)
// ============================================================
//
// Per-visitor drill-down. A "visitor" is an anonymous
// visitorHash (sha256 of ip + user agent). No IP or user agent
// is ever returned here — only the hash label, coarse geo, and
// device family.
// ============================================================

const VISITOR_LABEL = (hash) =>
    "Visitor " + String(hash || "").slice(0, 8);

const VISITOR_EVENT_CAP = 1000;


// ------------------------------------------------------------
// GET /api/analytics/visitors?period=&limit=&skip=
// ------------------------------------------------------------

export const getVisitors = async (req, res) => {
    try {
        const { period, start, end } = resolvePeriod(
            req.query.period
        );

        const limit = Math.min(
            Math.max(
                parseInt(req.query.limit, 10) || 25,
                1
            ),
            100
        );

        const skip = Math.max(
            parseInt(req.query.skip, 10) || 0,
            0
        );

        const [result] = await AnalyticsEvent.aggregate([
            {
                $match: {
                    visitorHash: { $ne: null },
                    createdAt: {
                        $gte: start,
                        $lte: end,
                    },
                },
            },
            // Sort ascending so $last picks the most recent
            // geo / device values for each visitor.
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: "$visitorHash",
                    pageViews: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: [
                                        "$type",
                                        "PAGE_VIEW",
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    interactions: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: [
                                        "$type",
                                        "INTERACTION",
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    sessions: { $addToSet: "$sessionId" },
                    firstSeen: { $min: "$createdAt" },
                    lastSeen: { $max: "$createdAt" },
                    country: { $last: "$geo.country" },
                    countryCode: {
                        $last: "$geo.countryCode",
                    },
                    deviceType: { $last: "$device.type" },
                    browser: { $last: "$device.browser" },
                    os: { $last: "$device.os" },
                },
            },
            {
                $project: {
                    _id: 0,
                    visitorHash: "$_id",
                    label: {
                        $concat: [
                            "Visitor ",
                            {
                                $substrCP: [
                                    "$_id",
                                    0,
                                    8,
                                ],
                            },
                        ],
                    },
                    pageViews: 1,
                    interactions: 1,
                    sessionCount: { $size: "$sessions" },
                    returning: {
                        $gt: [{ $size: "$sessions" }, 1],
                    },
                    firstSeen: 1,
                    lastSeen: 1,
                    country: 1,
                    countryCode: 1,
                    deviceType: {
                        $ifNull: ["$deviceType", "unknown"],
                    },
                    browser: 1,
                    os: 1,
                },
            },
            { $sort: { lastSeen: -1 } },
            {
                $facet: {
                    rows: [
                        { $skip: skip },
                        { $limit: limit },
                    ],
                    total: [{ $count: "value" }],
                },
            },
        ]);

        const rows = result?.rows || [];
        const total = result?.total?.[0]?.value || 0;

        return res.status(200).json({
            success: true,
            data: {
                period,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                total,
                limit,
                skip,
                visitors: rows,
            },
        });
    } catch (error) {
        console.error(
            "Visitor list error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load visitors.",
        });
    }
};


// ------------------------------------------------------------
// GET /api/analytics/visitors/:visitorHash?period=
// ------------------------------------------------------------

export const getVisitorDetail = async (req, res) => {
    try {
        const { visitorHash } = req.params;

        if (
            !isNonEmptyString(visitorHash) ||
            !/^[a-f0-9]{16,64}$/i.test(visitorHash)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid visitor reference.",
            });
        }

        const { period, start, end } = resolvePeriod(
            req.query.period
        );

        const events = await AnalyticsEvent.find(
            {
                visitorHash,
                createdAt: { $gte: start, $lte: end },
            },
            {
                type: 1,
                path: 1,
                action: 1,
                target: 1,
                durationMs: 1,
                sessionId: 1,
                referrer: 1,
                createdAt: 1,
                "geo.country": 1,
                "geo.countryCode": 1,
                "geo.city": 1,
                "device.type": 1,
                "device.browser": 1,
                "device.os": 1,
            }
        )
            .sort({ createdAt: 1 })
            .limit(VISITOR_EVENT_CAP)
            .lean();

        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message:
                    "No activity for this visitor in the selected period.",
            });
        }

        // --------------------------------------------------
        // SUMMARY
        // --------------------------------------------------

        const last = events[events.length - 1];

        let pageViews = 0;
        let interactions = 0;
        let totalDurationMs = 0;

        const sessionIds = new Set();
        const pageCounts = new Map();
        const actionCounts = new Map();

        // sessionId -> aggregate
        const sessionMap = new Map();

        for (const event of events) {
            sessionIds.add(event.sessionId);

            if (!sessionMap.has(event.sessionId)) {
                sessionMap.set(event.sessionId, {
                    sessionId: event.sessionId,
                    startedAt: event.createdAt,
                    endedAt: event.createdAt,
                    pageViews: 0,
                    interactions: 0,
                    entryPage: null,
                    exitPage: null,
                });
            }

            const session = sessionMap.get(
                event.sessionId
            );

            session.endedAt = event.createdAt;

            if (event.type === "PAGE_VIEW") {
                pageViews += 1;
                session.pageViews += 1;

                pageCounts.set(
                    event.path,
                    (pageCounts.get(event.path) || 0) + 1
                );

                if (!session.entryPage) {
                    session.entryPage = event.path;
                }

                session.exitPage = event.path;
            } else if (event.type === "PAGE_EXIT") {
                if (Number.isFinite(event.durationMs)) {
                    totalDurationMs += event.durationMs;
                }
            } else if (event.type === "INTERACTION") {
                interactions += 1;
                session.interactions += 1;

                if (event.action) {
                    actionCounts.set(
                        event.action,
                        (actionCounts.get(event.action) ||
                            0) + 1
                    );
                }
            }
        }

        const sortedCounts = (map) =>
            [...map.entries()]
                .map(([key, count]) => ({ key, count }))
                .sort((a, b) => b.count - a.count);

        // --------------------------------------------------
        // TIMELINE (page views + interactions only)
        // --------------------------------------------------

        const timeline = events
            .filter(
                (event) =>
                    event.type === "PAGE_VIEW" ||
                    event.type === "INTERACTION" ||
                    (event.type === "PAGE_EXIT" &&
                        Number.isFinite(event.durationMs))
            )
            .map((event) => ({
                type: event.type,
                path: event.path,
                action: event.action || null,
                target: event.target || null,
                durationMs: Number.isFinite(
                    event.durationMs
                )
                    ? event.durationMs
                    : null,
                sessionId: event.sessionId,
                at: event.createdAt,
            }));

        return res.status(200).json({
            success: true,
            data: {
                period,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                visitor: {
                    visitorHash,
                    label: VISITOR_LABEL(visitorHash),
                    country: last.geo?.country || null,
                    countryCode:
                        last.geo?.countryCode || null,
                    city: last.geo?.city || null,
                    device: {
                        type: last.device?.type || "unknown",
                        browser:
                            last.device?.browser || null,
                        os: last.device?.os || null,
                    },
                    firstSeen: events[0].createdAt,
                    lastSeen: last.createdAt,
                    sessionCount: sessionIds.size,
                    returning: sessionIds.size > 1,
                    pageViews,
                    interactions,
                    totalDurationMs,
                    truncated:
                        events.length >= VISITOR_EVENT_CAP,
                },
                sessions: [...sessionMap.values()].sort(
                    (a, b) =>
                        new Date(b.startedAt) -
                        new Date(a.startedAt)
                ),
                topPages: sortedCounts(pageCounts)
                    .slice(0, 8)
                    .map((row) => ({
                        path: row.key,
                        views: row.count,
                    })),
                topInteractions: sortedCounts(actionCounts)
                    .slice(0, 8)
                    .map((row) => ({
                        action: row.key,
                        count: row.count,
                    })),
                timeline,
            },
        });
    } catch (error) {
        console.error(
            "Visitor detail error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load visitor detail.",
        });
    }
};


// ============================================================
// VISITOR FLOW  (admin)
// ============================================================
//
// GET /api/analytics/flow?period=today|7d|30d|year
//
// How visitors move through the portfolio: entry pages, exit
// pages, page-to-page transitions, and the most common full
// navigation paths. Computed from PAGE_VIEW order within each
// session.
// ============================================================

const FLOW_SESSION_CAP = 5000;
const FLOW_PATH_MAX_STEPS = 6;


export const getVisitorFlow = async (req, res) => {
    try {
        const { period, start, end } = resolvePeriod(
            req.query.period
        );

        const sessions = await AnalyticsEvent.aggregate([
            {
                $match: {
                    type: "PAGE_VIEW",
                    createdAt: {
                        $gte: start,
                        $lte: end,
                    },
                },
            },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: "$sessionId",
                    pages: { $push: "$path" },
                },
            },
            { $limit: FLOW_SESSION_CAP },
        ]);

        const entryCounts = new Map();
        const exitCounts = new Map();
        const transitionCounts = new Map();
        const pathCounts = new Map();

        let totalPages = 0;
        let bouncedSessions = 0;

        const bump = (map, key) => {
            map.set(key, (map.get(key) || 0) + 1);
        };

        for (const session of sessions) {
            // Collapse immediate repeats (a page re-rendering
            // shouldn't read as A -> A).
            const steps = [];

            for (const path of session.pages) {
                if (
                    steps.length === 0 ||
                    steps[steps.length - 1] !== path
                ) {
                    steps.push(path);
                }
            }

            if (steps.length === 0) {
                continue;
            }

            totalPages += steps.length;

            bump(entryCounts, steps[0]);
            bump(exitCounts, steps[steps.length - 1]);

            if (steps.length === 1) {
                bouncedSessions += 1;
            }

            for (let i = 0; i < steps.length - 1; i += 1) {
                bump(
                    transitionCounts,
                    JSON.stringify([steps[i], steps[i + 1]])
                );
            }

            bump(
                pathCounts,
                JSON.stringify(
                    steps.slice(0, FLOW_PATH_MAX_STEPS)
                )
            );
        }

        const sessionCount = sessions.length;

        const rank = (map, limit) =>
            [...map.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit);

        return res.status(200).json({
            success: true,
            data: {
                period,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                totals: {
                    sessions: sessionCount,
                    bouncedSessions,
                    bounceRate:
                        sessionCount > 0
                            ? Math.round(
                                  (bouncedSessions /
                                      sessionCount) *
                                      100
                              )
                            : 0,
                    avgPagesPerSession:
                        sessionCount > 0
                            ? Math.round(
                                  (totalPages /
                                      sessionCount) *
                                      10
                              ) / 10
                            : 0,
                },
                entryPages: rank(entryCounts, 8).map(
                    ([path, count]) => ({ path, count })
                ),
                exitPages: rank(exitCounts, 8).map(
                    ([path, count]) => ({ path, count })
                ),
                transitions: rank(transitionCounts, 12).map(
                    ([key, count]) => {
                        const [from, to] = JSON.parse(key);
                        return { from, to, count };
                    }
                ),
                paths: rank(pathCounts, 8)
                    .map(([key, count]) => ({
                        steps: JSON.parse(key),
                        count,
                    }))
                    .filter((row) => row.steps.length > 1),
            },
        });
    } catch (error) {
        console.error(
            "Visitor flow error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load visitor flow.",
        });
    }
};


// ============================================================
// ENGAGEMENT ANALYTICS  (admin)
// ============================================================
//
// GET /api/analytics/engagement?period=today|7d|30d|year
//
// Time spent + a composite engagement score per page, so a
// page with many views but shallow attention can be told apart
// from one with fewer views but deep engagement.
// ============================================================

// A session counts as "engaged" if the visitor did more than
// glance: any interaction, or more than one page, or more than
// this many seconds on the site.
const ENGAGED_SESSION_MIN_MS = 15 * 1000;

// Weights for the composite page engagement score. Tune freely.
const ENGAGEMENT_WEIGHTS = {
    time: 0.35,
    interactionsPerView: 0.4,
    scrollDepth: 0.25,
};


export const getEngagementAnalytics = async (req, res) => {
    try {
        const { period, start, end, granularity } =
            resolvePeriod(req.query.period);

        const match = {
            createdAt: { $gte: start, $lte: end },
        };

        // ----------------------------------------------------
        // PER-PAGE + SESSION AGGREGATION
        // ----------------------------------------------------

        const [agg] = await AnalyticsEvent.aggregate([
            { $match: match },
            {
                $facet: {
                    // views per path
                    views: [
                        { $match: { type: "PAGE_VIEW" } },
                        {
                            $group: {
                                _id: "$path",
                                views: { $sum: 1 },
                            },
                        },
                    ],

                    // time per path (from PAGE_EXIT durations)
                    time: [
                        {
                            $match: {
                                type: "PAGE_EXIT",
                                durationMs: { $ne: null },
                            },
                        },
                        {
                            $group: {
                                _id: "$path",
                                totalMs: {
                                    $sum: "$durationMs",
                                },
                                avgMs: {
                                    $avg: "$durationMs",
                                },
                            },
                        },
                    ],

                    // interactions per path
                    interactions: [
                        {
                            $match: {
                                type: "INTERACTION",
                            },
                        },
                        {
                            $group: {
                                _id: "$path",
                                count: { $sum: 1 },
                            },
                        },
                    ],

                    // scroll depth: per (path, session) take the
                    // furthest bucket reached, then average per path
                    scroll: [
                        {
                            $match: {
                                type: "INTERACTION",
                                action: "SCROLL_DEPTH",
                            },
                        },
                        {
                            $group: {
                                _id: {
                                    path: "$path",
                                    session: "$sessionId",
                                },
                                maxDepth: {
                                    $max: {
                                        $convert: {
                                            input: "$target",
                                            to: "int",
                                            onError: 0,
                                            onNull: 0,
                                        },
                                    },
                                },
                            },
                        },
                        {
                            $group: {
                                _id: "$_id.path",
                                avgDepth: {
                                    $avg: "$maxDepth",
                                },
                            },
                        },
                    ],

                    // per-session totals for engagement rate
                    // and average session duration
                    sessions: [
                        {
                            $group: {
                                _id: "$sessionId",
                                visitorHash: {
                                    $first: "$visitorHash",
                                },
                                pageViews: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $eq: [
                                                    "$type",
                                                    "PAGE_VIEW",
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },
                                interactions: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $eq: [
                                                    "$type",
                                                    "INTERACTION",
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },
                                durationMs: {
                                    $sum: {
                                        $ifNull: [
                                            "$durationMs",
                                            0,
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        ]);

        // ----------------------------------------------------
        // MERGE PER-PAGE
        // ----------------------------------------------------

        const byPath = new Map();

        const ensure = (path) => {
            if (!byPath.has(path)) {
                byPath.set(path, {
                    path,
                    views: 0,
                    totalTimeMs: 0,
                    avgTimeMs: 0,
                    interactions: 0,
                    avgScrollDepth: 0,
                });
            }
            return byPath.get(path);
        };

        for (const row of agg.views || []) {
            ensure(row._id).views = row.views;
        }
        for (const row of agg.time || []) {
            const page = ensure(row._id);
            page.totalTimeMs = Math.round(row.totalMs);
            page.avgTimeMs = Math.round(row.avgMs);
        }
        for (const row of agg.interactions || []) {
            ensure(row._id).interactions = row.count;
        }
        for (const row of agg.scroll || []) {
            ensure(row._id).avgScrollDepth = Math.round(
                row.avgDepth
            );
        }

        let pages = [...byPath.values()].filter(
            (page) => page.views > 0
        );

        // ----------------------------------------------------
        // ENGAGEMENT SCORE (min-max normalized across pages)
        // ----------------------------------------------------

        const withRatios = pages.map((page) => ({
            ...page,
            interactionsPerView:
                page.views > 0
                    ? page.interactions / page.views
                    : 0,
        }));

        const maxOf = (key) =>
            withRatios.reduce(
                (max, page) => Math.max(max, page[key]),
                0
            );

        const maxTime = maxOf("avgTimeMs");
        const maxIpv = maxOf("interactionsPerView");
        const maxScroll = maxOf("avgScrollDepth");

        pages = withRatios
            .map((page) => {
                const timeN = maxTime
                    ? page.avgTimeMs / maxTime
                    : 0;
                const ipvN = maxIpv
                    ? page.interactionsPerView / maxIpv
                    : 0;
                const scrollN = maxScroll
                    ? page.avgScrollDepth / maxScroll
                    : 0;

                const score = Math.round(
                    (timeN * ENGAGEMENT_WEIGHTS.time +
                        ipvN *
                            ENGAGEMENT_WEIGHTS.interactionsPerView +
                        scrollN *
                            ENGAGEMENT_WEIGHTS.scrollDepth) *
                        100
                );

                return {
                    path: page.path,
                    views: page.views,
                    avgTimeMs: page.avgTimeMs,
                    totalTimeMs: page.totalTimeMs,
                    interactions: page.interactions,
                    interactionsPerView:
                        Math.round(
                            page.interactionsPerView * 100
                        ) / 100,
                    avgScrollDepth: page.avgScrollDepth,
                    engagementScore: score,
                };
            })
            .sort(
                (a, b) =>
                    b.engagementScore - a.engagementScore
            );

        // ----------------------------------------------------
        // SESSION TOTALS
        // ----------------------------------------------------

        const sessionRows = agg.sessions || [];
        const sessionCount = sessionRows.length;

        let engagedSessions = 0;
        let totalSessionMs = 0;
        const visitorSessionCounts = new Map();

        for (const session of sessionRows) {
            totalSessionMs += session.durationMs || 0;

            if (
                session.interactions > 0 ||
                session.pageViews > 1 ||
                session.durationMs >= ENGAGED_SESSION_MIN_MS
            ) {
                engagedSessions += 1;
            }

            if (session.visitorHash) {
                visitorSessionCounts.set(
                    session.visitorHash,
                    (visitorSessionCounts.get(
                        session.visitorHash
                    ) || 0) + 1
                );
            }
        }

        let repeatVisitors = 0;
        for (const count of visitorSessionCounts.values()) {
            if (count > 1) {
                repeatVisitors += 1;
            }
        }

        // ----------------------------------------------------
        // ACTIVITY SERIES (sessions / views / interactions)
        // ----------------------------------------------------

        const [seriesAgg] = await AnalyticsEvent.aggregate([
            { $match: match },
            {
                $facet: {
                    views: [
                        { $match: { type: "PAGE_VIEW" } },
                        {
                            $group: {
                                _id: {
                                    $dateTrunc: {
                                        date: "$createdAt",
                                        unit: granularity,
                                    },
                                },
                                n: { $sum: 1 },
                            },
                        },
                    ],
                    interactions: [
                        {
                            $match: {
                                type: "INTERACTION",
                            },
                        },
                        {
                            $group: {
                                _id: {
                                    $dateTrunc: {
                                        date: "$createdAt",
                                        unit: granularity,
                                    },
                                },
                                n: { $sum: 1 },
                            },
                        },
                    ],
                    sessions: [
                        {
                            $group: {
                                _id: {
                                    bucket: {
                                        $dateTrunc: {
                                            date: "$createdAt",
                                            unit: granularity,
                                        },
                                    },
                                    session: "$sessionId",
                                },
                            },
                        },
                        {
                            $group: {
                                _id: "$_id.bucket",
                                n: { $sum: 1 },
                            },
                        },
                    ],
                },
            },
        ]);

        const toMap = (rows) => {
            const map = new Map();
            for (const row of rows || []) {
                map.set(
                    new Date(row._id).toISOString(),
                    row.n
                );
            }
            return map;
        };

        const viewsMap = toMap(seriesAgg.views);
        const interactionsMap = toMap(
            seriesAgg.interactions
        );
        const sessionsMap = toMap(seriesAgg.sessions);

        const activity = bucketKeys(
            start,
            end,
            granularity
        ).map((key) => ({
            date: key,
            pageViews: viewsMap.get(key) || 0,
            interactions: interactionsMap.get(key) || 0,
            sessions: sessionsMap.get(key) || 0,
        }));

        return res.status(200).json({
            success: true,
            data: {
                period,
                granularity,
                range: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                },
                totals: {
                    sessions: sessionCount,
                    engagedSessions,
                    engagementRate:
                        sessionCount > 0
                            ? Math.round(
                                  (engagedSessions /
                                      sessionCount) *
                                      100
                              )
                            : 0,
                    avgSessionDurationMs:
                        sessionCount > 0
                            ? Math.round(
                                  totalSessionMs /
                                      sessionCount
                              )
                            : 0,
                    totalTimeMs: totalSessionMs,
                    repeatVisitors,
                },
                pages,
                activity,
                weights: ENGAGEMENT_WEIGHTS,
            },
        });
    } catch (error) {
        console.error(
            "Engagement analytics error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load engagement analytics.",
        });
    }
};


// ============================================================
// PUBLIC ANALYTICS  (unauthenticated)
// ============================================================
//
// GET /api/analytics/public
//
// A sanitized, aggregated snapshot safe to show portfolio
// visitors. Fixed 30-day window. Never exposes visitor hashes,
// IPs, individual sessions, geo, or raw events — only counts,
// durations, and public route paths.
//
// The result is cached in memory so a burst of visitors does
// not translate into a burst of aggregations.
// ============================================================

const PUBLIC_ANALYTICS_TTL_MS = 5 * 60 * 1000;
const PUBLIC_ANALYTICS_WINDOW_DAYS = 30;

let publicAnalyticsCache = {
    data: null,
    expiresAt: 0,
};


const computePublicAnalytics = async () => {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(
        start.getUTCDate() - PUBLIC_ANALYTICS_WINDOW_DAYS
    );
    start.setUTCHours(0, 0, 0, 0);

    const match = {
        createdAt: { $gte: start, $lte: end },
    };

    const [agg] = await AnalyticsEvent.aggregate([
        { $match: match },
        {
            $facet: {
                pageViews: [
                    { $match: { type: "PAGE_VIEW" } },
                    { $count: "value" },
                ],
                visitors: [
                    {
                        $match: {
                            visitorHash: { $ne: null },
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            v: {
                                $addToSet: "$visitorHash",
                            },
                        },
                    },
                    {
                        $project: {
                            value: { $size: "$v" },
                        },
                    },
                ],
                interactions: [
                    { $match: { type: "INTERACTION" } },
                    { $count: "value" },
                ],
                mostViewedPage: [
                    { $match: { type: "PAGE_VIEW" } },
                    {
                        $group: {
                            _id: "$path",
                            n: { $sum: 1 },
                        },
                    },
                    { $sort: { n: -1 } },
                    { $limit: 1 },
                ],
                mostInteractedPage: [
                    { $match: { type: "INTERACTION" } },
                    {
                        $group: {
                            _id: "$path",
                            n: { $sum: 1 },
                        },
                    },
                    { $sort: { n: -1 } },
                    { $limit: 1 },
                ],
                actionCounts: [
                    { $match: { type: "INTERACTION" } },
                    {
                        $group: {
                            _id: "$action",
                            n: { $sum: 1 },
                        },
                    },
                ],
                sessions: [
                    {
                        $group: {
                            _id: "$sessionId",
                            pageViews: {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                "$type",
                                                "PAGE_VIEW",
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                            interactions: {
                                $sum: {
                                    $cond: [
                                        {
                                            $eq: [
                                                "$type",
                                                "INTERACTION",
                                            ],
                                        },
                                        1,
                                        0,
                                    ],
                                },
                            },
                            durationMs: {
                                $sum: {
                                    $ifNull: [
                                        "$durationMs",
                                        0,
                                    ],
                                },
                            },
                        },
                    },
                ],
            },
        },
    ]);

    const actionCount = (name) =>
        (agg.actionCounts || []).find(
            (row) => row._id === name
        )?.n || 0;

    const sessionRows = agg.sessions || [];
    const sessionCount = sessionRows.length;

    let engaged = 0;
    let totalSessionMs = 0;

    for (const session of sessionRows) {
        totalSessionMs += session.durationMs || 0;

        if (
            session.interactions > 0 ||
            session.pageViews > 1 ||
            session.durationMs >= 15 * 1000
        ) {
            engaged += 1;
        }
    }

    return {
        windowDays: PUBLIC_ANALYTICS_WINDOW_DAYS,
        updatedAt: new Date().toISOString(),
        totals: {
            visitors: agg.visitors?.[0]?.value || 0,
            pageViews: agg.pageViews?.[0]?.value || 0,
            sessions: sessionCount,
            interactions:
                agg.interactions?.[0]?.value || 0,
            avgSessionDurationMs:
                sessionCount > 0
                    ? Math.round(
                          totalSessionMs / sessionCount
                      )
                    : 0,
            engagementRate:
                sessionCount > 0
                    ? Math.round(
                          (engaged / sessionCount) * 100
                      )
                    : 0,
        },
        mostViewedPage:
            agg.mostViewedPage?.[0]?._id || null,
        mostInteractedPage:
            agg.mostInteractedPage?.[0]?._id || null,
        activity: {
            projectsOpened: actionCount("PROJECT_OPENED"),
            resumeDownloads: actionCount("RESUME_DOWNLOAD"),
            externalLinkClicks:
                actionCount("EXTERNAL_LINK_CLICK") +
                actionCount("GITHUB_CLICK") +
                actionCount("EMAIL_CLICK"),
            contactFormSubmissions: actionCount(
                "CONTACT_FORM_SUBMITTED"
            ),
        },
    };
};


export const getPublicAnalytics = async (req, res) => {
    try {
        const now = Date.now();

        if (
            !publicAnalyticsCache.data ||
            publicAnalyticsCache.expiresAt <= now
        ) {
            publicAnalyticsCache = {
                data: await computePublicAnalytics(),
                expiresAt: now + PUBLIC_ANALYTICS_TTL_MS,
            };
        }

        return res.status(200).json({
            success: true,
            data: publicAnalyticsCache.data,
        });
    } catch (error) {
        console.error(
            "Public analytics error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load analytics.",
        });
    }
};
