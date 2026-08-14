import rateLimit from "express-rate-limit";

// ============================================================
// LOGIN RATE LIMITER
// ============================================================
//
// Protects username/password login from brute-force attacks.
//
// 5 attempts per 15 minutes per IP.
// ============================================================

export const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    max: 5,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
        success: false,
        message:
            "Too many login attempts. Please try again later.",
    },
});

// ============================================================
// 2FA RATE LIMITER
// ============================================================
//
// Protects 6-digit authentication codes from repeated guessing.
//
// 5 attempts per 10 minutes per IP.
// ============================================================

export const twoFactorRateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,

    max: 5,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
        success: false,
        message:
            "Too many authentication attempts. Please try again later.",
    },
});

// ============================================================
// PASSWORD RESET RATE LIMITER
// ============================================================
//
// Protects password changes that require 2FA.
//
// 5 attempts per 15 minutes per IP.
// ============================================================

export const passwordResetRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    max: 5,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
        success: false,
        message:
            "Too many password reset attempts. Please try again later.",
    },
});