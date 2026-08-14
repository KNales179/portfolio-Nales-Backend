import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";

export const protect = async (req, res, next) => {
    try {
        let token;

        if (
            req.headers.authorization &&
            req.headers.authorization.startsWith("Bearer ")
        ) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            );
        } catch (error) {
            if (error.name === "TokenExpiredError") {
                return res.status(401).json({
                    success: false,
                    message: "Authentication token expired",
                });
            }

            return res.status(401).json({
                success: false,
                message: "Invalid authentication token",
            });
        }

        if (!decoded.sessionId) {
            return res.status(401).json({
                success: false,
                message:
                    "Authentication session is invalid",
            });
        }

        const session =
            await AdminSession.findOne({
                sessionId: decoded.sessionId,
                admin: decoded.id,
            });

        if (!session) {
            return res.status(401).json({
                success: false,
                message:
                    "Authentication session not found",
            });
        }

        if (session.revokedAt) {
            return res.status(401).json({
                success: false,
                message:
                    "Authentication session has been revoked",
            });
        }

        if (
            session.expiresAt &&
            session.expiresAt <= new Date()
        ) {
            return res.status(401).json({
                success: false,
                message:
                    "Authentication session has expired",
            });
        }

        const admin = await Admin.findById(decoded.id);

        if (!admin) {
            return res.status(401).json({
                success: false,
                message: "Admin account no longer exists",
            });
        }

        if (
            decoded.tokenVersion !==
            (admin.tokenVersion || 0)
        ) {
            return res.status(401).json({
                success: false,
                message: "Authentication session has been revoked",
            });
        }

        if (admin.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "Admin account is inactive",
            });
        }

        session.lastUsedAt = new Date();

        await session.save();

        req.user = admin;
        req.session = session;

        next();
    } catch (error) {
        console.error(
            "Authentication middleware error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Authentication failed",
        });
    }
};