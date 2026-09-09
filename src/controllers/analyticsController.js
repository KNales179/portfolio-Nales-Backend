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
