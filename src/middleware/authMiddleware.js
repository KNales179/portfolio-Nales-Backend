import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";

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

        const admin = await Admin.findById(decoded.id);

        if (!admin) {
            return res.status(401).json({
                success: false,
                message: "Admin account no longer exists",
            });
        }

        if (admin.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "Admin account is inactive",
            });
        }

        req.user = admin;

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