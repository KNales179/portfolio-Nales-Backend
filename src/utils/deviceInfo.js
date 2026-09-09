import crypto from "node:crypto";


// ============================================================
// DEVICE INFO
// ============================================================
//
// Lightweight user-agent parsing for analytics.
//
// This intentionally does NOT use a full UA-parsing library.
// Analytics only needs a coarse breakdown (mobile / tablet /
// desktop, plus a browser and OS family), and a small
// hand-rolled matcher keeps the backend dependency-free.
// ============================================================


// ============================================================
// DEVICE TYPE
// ============================================================

const getDeviceType = (ua) => {
    if (!ua) {
        return "unknown";
    }

    const value = ua.toLowerCase();

    // Tablets first — many tablet UAs also contain "mobile"
    // tokens, so the desktop/mobile split alone is not enough.
    const isTablet =
        /ipad/.test(value) ||
        /android(?!.*mobile)/.test(value) ||
        (/tablet|playbook|silk/.test(value) &&
            !/mobile/.test(value));

    if (isTablet) {
        return "tablet";
    }

    const isMobile =
        /mobi|iphone|ipod|android.*mobile|windows phone|blackberry|bb10|opera mini|iemobile/.test(
            value
        );

    if (isMobile) {
        return "mobile";
    }

    return "desktop";
};


// ============================================================
// BROWSER
// ============================================================

const getBrowser = (ua) => {
    if (!ua) {
        return null;
    }

    // Order matters: Edge/Opera/Brave spoof Chrome, Chrome
    // spoofs Safari, etc.
    const checks = [
        ["Edge", /\bedg(?:e|a|ios)?\//i],
        ["Opera", /\bopr\/|\bopera\//i],
        ["Samsung Internet", /samsungbrowser\//i],
        ["Firefox", /\bfxios\/|\bfirefox\//i],
        ["Chrome", /\bcrios\/|\bchrome\//i],
        ["Safari", /\bsafari\//i],
        ["Internet Explorer", /\bmsie\s|\btrident\//i],
    ];

    for (const [name, pattern] of checks) {
        if (pattern.test(ua)) {
            return name;
        }
    }

    return null;
};


// ============================================================
// OPERATING SYSTEM
// ============================================================

const getOperatingSystem = (ua) => {
    if (!ua) {
        return null;
    }

    const checks = [
        ["Android", /android/i],
        ["iOS", /iphone|ipad|ipod/i],
        ["Windows", /windows nt|win64|win32|windows phone/i],
        ["macOS", /mac os x|macintosh/i],
        ["Chrome OS", /cros/i],
        ["Linux", /linux/i],
    ];

    for (const [name, pattern] of checks) {
        if (pattern.test(ua)) {
            return name;
        }
    }

    return null;
};


// ============================================================
// PARSE
// ============================================================

export const parseDevice = (userAgent) => {
    const ua =
        typeof userAgent === "string"
            ? userAgent
            : "";

    return {
        type: getDeviceType(ua),
        browser: getBrowser(ua),
        os: getOperatingSystem(ua),
    };
};


// ============================================================
// VISITOR HASH
// ============================================================
//
// Anonymous, stable-ish identifier for estimating unique and
// returning visitors. It is a one-way hash of IP + user agent
// and cannot be reversed to an IP or a person.
// ============================================================

export const buildVisitorHash = (
    ipAddress,
    userAgent
) => {
    const ip =
        typeof ipAddress === "string"
            ? ipAddress
            : "";

    const ua =
        typeof userAgent === "string"
            ? userAgent
            : "";

    if (!ip && !ua) {
        return null;
    }

    return crypto
        .createHash("sha256")
        .update(`${ip}|${ua}`)
        .digest("hex");
};


// ============================================================
// CLIENT IP
// ============================================================
//
// `app.set("trust proxy", true)` is already configured, so
// `req.ip` respects X-Forwarded-For. This just normalizes the
// IPv6-mapped IPv4 form ("::ffff:1.2.3.4" -> "1.2.3.4").
// ============================================================

export const getClientIp = (req) => {
    const raw =
        req.ip ||
        req.connection?.remoteAddress ||
        "";

    return raw.replace(/^::ffff:/, "");
};
