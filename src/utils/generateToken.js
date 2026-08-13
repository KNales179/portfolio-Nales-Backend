import jwt from "jsonwebtoken";

const generateToken = (admin) => {
    return jwt.sign(
        {
            id: admin._id,
            username: admin.username,
            role: admin.role,
            mustChangePassword: admin.mustChangePassword,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || "1d",
        }
    );
};

export default generateToken;