import jwt from "jsonwebtoken";
import { verify } from "otplib";

import Admin from "../models/Admin.js";
import { decryptSecret } from "./secretCrypto.js";


// ============================================================
// TWO-FACTOR HELPERS
// ============================================================


// ------------------------------------------------------------
// CHALLENGE TOKEN
// ------------------------------------------------------------
//
// The short-lived token issued after password success, before
// the TOTP code is entered. Signed with a dedicated secret so
// it can never be confused with a real session JWT.
// ------------------------------------------------------------

const challengeSecret = () =>
    process.env.JWT_2FA_SECRET ||
    process.env.JWT_SECRET;


export const signTwoFactorChallenge = (
    payload,
    options = {}
) => {
    return jwt.sign(
        {
            ...payload,
            type: "2FA_CHALLENGE",
        },
        challengeSecret(),
        options
    );
};


export const verifyTwoFactorChallenge = (token) => {
    const decoded = jwt.verify(token, challengeSecret());

    if (decoded.type !== "2FA_CHALLENGE") {
        const error = new Error("Invalid 2FA challenge");
        error.name = "JsonWebTokenError";
        throw error;
    }

    return decoded;
};


// ------------------------------------------------------------
// CODE VERIFICATION (with replay protection)
// ------------------------------------------------------------
//
// otplib's verify() accepts a code for its whole ~90s window,
// so the same 6 digits would otherwise work several times. We
// persist the last-accepted time step per admin and reject any
// step that is not strictly newer.
//
// The step is persisted with a targeted atomic update so it
// sticks even if the calling controller doesn't save the admin
// document afterwards.
//
// Returns: { valid: boolean, reason?: "FORMAT"|"NO_SECRET"|"INVALID"|"REPLAY" }
// ------------------------------------------------------------

export const verifyTwoFactorCode = async (
    admin,
    rawCode
) => {
    const code = String(rawCode ?? "").replace(/\D/g, "");

    if (!/^\d{6}$/.test(code)) {
        return { valid: false, reason: "FORMAT" };
    }

    if (!admin || !admin.twoFactorSecret) {
        return { valid: false, reason: "NO_SECRET" };
    }

    let secret;

    try {
        secret = decryptSecret(admin.twoFactorSecret);
    } catch {
        return { valid: false, reason: "NO_SECRET" };
    }

    const result = await verify({
        secret,
        token: code,
    });

    if (!result.valid) {
        return { valid: false, reason: "INVALID" };
    }

    const usedStep = result.timeStep;

    if (
        typeof usedStep === "number" &&
        typeof admin.twoFactorLastUsedStep === "number" &&
        usedStep <= admin.twoFactorLastUsedStep
    ) {
        return { valid: false, reason: "REPLAY" };
    }

    if (typeof usedStep === "number") {
        admin.twoFactorLastUsedStep = usedStep;

        await Admin.updateOne(
            { _id: admin._id },
            { $set: { twoFactorLastUsedStep: usedStep } }
        );
    }

    return { valid: true };
};
