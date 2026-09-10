import { verifyStepUpToken } from "../utils/twoFactor.js";


// ============================================================
// REQUIRE STEP-UP
// ============================================================
//
// Guards sensitive admin-management actions. The client sends a
// short-lived step-up token (issued by POST /api/admin/verify-2fa
// after a fresh TOTP check) in the `X-Step-Up` header. The token
// must belong to the authenticated admin. Runs after `protect`.
// ============================================================

export const requireStepUp = (req, res, next) => {
    const token = req.get("x-step-up");

    if (!token) {
        return res.status(401).json({
            success: false,
            code: "STEP_UP_REQUIRED",
            message: "Two-factor verification is required.",
        });
    }

    try {
        const decoded = verifyStepUpToken(token);

        if (
            !req.user ||
            decoded.sub !== String(req.user._id)
        ) {
            return res.status(401).json({
                success: false,
                code: "STEP_UP_REQUIRED",
                message:
                    "Verification does not match this account.",
            });
        }

        return next();
    } catch {
        return res.status(401).json({
            success: false,
            code: "STEP_UP_REQUIRED",
            message:
                "Verification expired. Please verify again.",
        });
    }
};
