import AnalyticsEvent, {
    ANALYTICS_EVENT_TYPES,
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

            documents.push({
                type: event.type,
                sessionId: event.sessionId.trim(),
                visitorHash,
                path: event.path.trim(),
                referrer,
                durationMs,
                device,
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
