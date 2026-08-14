import jwt from "jsonwebtoken";

const generateToken = (admin, sessionId = null) => {
    return jwt.sign(
        {
            id: admin._id,
            username: admin.username,
            role: admin.role,
            sessionId,
            mustChangePassword: admin.mustChangePassword,
            tokenVersion: admin.tokenVersion || 0,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || "8h",
        }
    );
};

export default generateToken;