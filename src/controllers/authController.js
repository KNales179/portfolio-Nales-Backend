import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import AuditLog from "../models/AuditLog.js";
import generateToken from "../utils/generateToken.js";

import {
  generateSecret,
  generateURI,
  verify,
} from "otplib";

import QRCode from "qrcode";

// ============================================================
// CONSTANTS
// ============================================================

const TWO_FACTOR_CHALLENGE_EXPIRES_IN = "5m";

const TWO_FACTOR_ISSUER =
  process.env.TWO_FACTOR_ISSUER ||
  "Portfolio Admin";

// ============================================================
// HELPER
// ============================================================

const getAdminResponse = (admin) => ({
  id: admin._id,
  username: admin.username,
  fullName: admin.fullName,
  email: admin.email,
  phone: admin.phone,
  role: admin.role,
  status: admin.status,
  mustChangePassword: admin.mustChangePassword,
  twoFactorEnabled: admin.twoFactorEnabled,
  profileImage:
    admin.profileImage?.url || null,
});

// ============================================================
// INITIAL SUPER ADMIN SETUP
// ============================================================

export const setupSuperAdmin = async (req, res) => {
  try {
    // --------------------------------------------------------
    // ONLY ALLOW SETUP WHEN NO SUPER ADMIN EXISTS
    // --------------------------------------------------------

    const existingSuperAdmin =
      await Admin.findOne({
        role: "SUPER_ADMIN",
      });

    if (existingSuperAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Super admin has already been configured",
      });
    }

    // --------------------------------------------------------
    // REQUEST DATA
    // --------------------------------------------------------

    const {
      username,
      password,
      fullName,
      email,
      phone,
    } = req.body;

    if (
      !username ||
      !password ||
      !fullName
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Username, password and full name are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters long",
      });
    }

    // --------------------------------------------------------
    // NORMALIZE USERNAME
    // --------------------------------------------------------

    const normalizedUsername =
      username.trim().toLowerCase();

    // --------------------------------------------------------
    // CHECK USERNAME
    // --------------------------------------------------------

    const existingUsername =
      await Admin.findOne({
        username: normalizedUsername,
      });

    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message:
          "Username already exists",
      });
    }

    // --------------------------------------------------------
    // HASH PASSWORD
    // --------------------------------------------------------

    const hashedPassword =
      await bcrypt.hash(password, 12);

    // --------------------------------------------------------
    // CREATE SUPER ADMIN
    // --------------------------------------------------------

    const admin = await Admin.create({
      username: normalizedUsername,

      password: hashedPassword,

      fullName: fullName.trim(),

      email: email
        ? email.trim().toLowerCase()
        : null,

      phone: phone
        ? phone.trim()
        : null,

      role: "SUPER_ADMIN",

      status: "ACTIVE",

      mustChangePassword: false,

      twoFactorEnabled: false,

      twoFactorSecret: null,

      trustedDevices: [],
    });

    // --------------------------------------------------------
    // AUDIT LOG
    // --------------------------------------------------------

    await AuditLog.create({
      admin: admin._id,

      action: "CREATE",

      resource: "ADMIN",

      resourceId: admin._id,

      description:
        "Initial SUPER_ADMIN account created",

      ipAddress: req.ip,

      userAgent:
        req.get("user-agent"),
    });

    // --------------------------------------------------------
    // GENERATE LOGIN TOKEN
    // --------------------------------------------------------

    const token = generateToken(admin);

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    return res.status(201).json({
      success: true,

      message:
        "Super admin account created successfully",

      data: {
        token,

        admin:
          getAdminResponse(admin),
      },
    });
  } catch (error) {
    console.error(
      "Setup super admin error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to create super admin account",
    });
  }
};

// ============================================================
// LOGIN
// ============================================================

export const login = async (req, res) => {
  try {
    const {
      username,
      password,
    } = req.body;

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Username and password are required",
      });
    }

    // --------------------------------------------------------
    // FIND ADMIN
    // --------------------------------------------------------

    const admin =
      await Admin.findOne({
        username:
          username
            .trim()
            .toLowerCase(),
      }).select("+password");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid username or password",
      });
    }

    // --------------------------------------------------------
    // CHECK STATUS
    // --------------------------------------------------------

    if (admin.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "This account is inactive",
      });
    }

    // --------------------------------------------------------
    // CHECK PASSWORD
    // --------------------------------------------------------

    const passwordMatches =
      await bcrypt.compare(
        password,
        admin.password
      );

    if (!passwordMatches) {
      await AuditLog.create({
        admin: admin._id,

        action: "LOGIN_FAILED",

        resource: "ADMIN",

        resourceId: admin._id,

        description:
          "Failed login attempt",

        ipAddress: req.ip,

        userAgent:
          req.get("user-agent"),
      });

      return res.status(401).json({
        success: false,
        message:
          "Invalid username or password",
      });
    }

    // ========================================================
    // 2FA CHECK
    // ========================================================

    if (
      admin.twoFactorEnabled &&
      admin.twoFactorSecret
    ) {
      // ----------------------------------------------------
      // CREATE SHORT-LIVED 2FA CHALLENGE TOKEN
      // ----------------------------------------------------

      const challengeToken =
        jwt.sign(
          {
            id: admin._id.toString(),

            type: "2FA_CHALLENGE",
          },

          process.env.JWT_SECRET,

          {
            expiresIn:
              TWO_FACTOR_CHALLENGE_EXPIRES_IN,
          }
        );

      // ----------------------------------------------------
      // AUDIT
      // ----------------------------------------------------

      await AuditLog.create({
        admin: admin._id,

        action: "LOGIN_2FA_REQUIRED",

        resource: "ADMIN",

        resourceId: admin._id,

        description:
          "Password verified; 2FA verification required",

        ipAddress: req.ip,

        userAgent:
          req.get("user-agent"),
      });

      // ----------------------------------------------------
      // DO NOT ISSUE REAL JWT YET
      // ----------------------------------------------------

      return res.json({
        success: true,

        requiresTwoFactor: true,

        message:
          "Two-factor authentication required",

        data: {
          challengeToken,
          username: admin.username,
        },
      });
    }

    // ========================================================
    // NORMAL LOGIN WHEN 2FA IS DISABLED
    // ========================================================

    admin.lastLogin = new Date();

    admin.lastLoginIP = req.ip;

    await admin.save();

    const token =
      generateToken(admin);

    // --------------------------------------------------------
    // AUDIT
    // --------------------------------------------------------

    await AuditLog.create({
      admin: admin._id,

      action: "LOGIN",

      resource: "ADMIN",

      resourceId: admin._id,

      description:
        "Admin logged in successfully",

      ipAddress: req.ip,

      userAgent:
        req.get("user-agent"),
    });

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    return res.json({
      success: true,

      requiresTwoFactor: false,

      message:
        "Login successful",

      data: {
        token,

        admin:
          getAdminResponse(admin),
      },
    });
  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Login failed",
    });
  }
};

// ============================================================
// VERIFY 2FA DURING LOGIN
// ============================================================

export const verifyLoginTwoFactor = async (
  req,
  res
) => {
  try {
    const {
      challengeToken,
      code,
    } = req.body;

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (
      !challengeToken ||
      !code
    ) {
      return res.status(400).json({
        success: false,
        message:
          "2FA challenge token and verification code are required",
      });
    }

    // --------------------------------------------------------
    // VERIFY CHALLENGE TOKEN
    // --------------------------------------------------------

    let decoded;

    try {
      decoded = jwt.verify(
        challengeToken,
        process.env.JWT_SECRET
      );
    } catch (error) {
      if (
        error.name ===
        "TokenExpiredError"
      ) {
        return res.status(401).json({
          success: false,
          message:
            "2FA verification session expired. Please login again.",
        });
      }

      return res.status(401).json({
        success: false,
        message:
          "Invalid 2FA verification session",
      });
    }

    // --------------------------------------------------------
    // MAKE SURE THIS IS A 2FA CHALLENGE
    // --------------------------------------------------------

    if (
      decoded.type !==
      "2FA_CHALLENGE"
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid 2FA challenge",
      });
    }

    // --------------------------------------------------------
    // FIND ADMIN
    // --------------------------------------------------------

    const admin =
      await Admin.findById(
        decoded.id
      ).select(
        "+twoFactorSecret"
      );

    if (!admin) {
      return res.status(401).json({
        success: false,
        message:
          "Admin account no longer exists",
      });
    }

    // --------------------------------------------------------
    // CHECK STATUS
    // --------------------------------------------------------

    if (admin.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "Admin account is inactive",
      });
    }

    // --------------------------------------------------------
    // CHECK 2FA
    // --------------------------------------------------------

    if (
      !admin.twoFactorEnabled ||
      !admin.twoFactorSecret
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Two-factor authentication is not enabled for this account",
      });
    }

    // --------------------------------------------------------
    // NORMALIZE CODE
    // --------------------------------------------------------

    const normalizedCode =
      String(code)
        .replace(/\s/g, "")
        .trim();

    if (
      !/^\d{6}$/.test(
        normalizedCode
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "2FA code must contain 6 digits",
      });
    }

    // --------------------------------------------------------
    // VERIFY TOTP
    // --------------------------------------------------------

    const verification =
      await verify({
        secret:
          admin.twoFactorSecret,

        token:
          normalizedCode,
      });

    if (!verification.valid) {
      await AuditLog.create({
        admin: admin._id,

        action:
          "LOGIN_2FA_FAILED",

        resource: "ADMIN",

        resourceId: admin._id,

        description:
          "Invalid 2FA verification code",

        ipAddress: req.ip,

        userAgent:
          req.get("user-agent"),
      });

      return res.status(401).json({
        success: false,
        message:
          "Invalid authentication code",
      });
    }

    // ========================================================
    // 2FA SUCCESS
    // ========================================================

    admin.lastLogin = new Date();

    admin.lastLoginIP = req.ip;

    await admin.save();

    // --------------------------------------------------------
    // GENERATE REAL AUTH TOKEN
    // --------------------------------------------------------

    const token =
      generateToken(admin);

    // --------------------------------------------------------
    // AUDIT
    // --------------------------------------------------------

    await AuditLog.create({
      admin: admin._id,

      action: "LOGIN",

      resource: "ADMIN",

      resourceId: admin._id,

      description:
        "Admin logged in successfully with 2FA",

      ipAddress: req.ip,

      userAgent:
        req.get("user-agent"),
    });

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    return res.json({
      success: true,

      requiresTwoFactor: false,

      message:
        "Login successful",

      data: {
        token,

        admin:
          getAdminResponse(admin),
      },
    });
  } catch (error) {
    console.error(
      "Verify login 2FA error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to verify 2FA",
    });
  }
};

// ============================================================
// GENERATE 2FA SETUP
// ============================================================

export const setupTwoFactor = async (
  req,
  res
) => {
  try {
    const admin =
      await Admin.findById(
        req.user._id
      ).select(
        "+twoFactorSecret"
      );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    // --------------------------------------------------------
    // ALREADY ENABLED
    // --------------------------------------------------------

    if (
      admin.twoFactorEnabled
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Two-factor authentication is already enabled",
      });
    }

    // --------------------------------------------------------
    // GENERATE SECRET
    // --------------------------------------------------------

    const secret =
      generateSecret();

    // --------------------------------------------------------
    // GENERATE AUTHENTICATOR URI
    // --------------------------------------------------------

    const uri = generateURI({
      issuer: TWO_FACTOR_ISSUER,
      label: admin.email || admin.username,
      secret,
    });

    const qrCode =
      await QRCode.toDataURL(uri);

    // --------------------------------------------------------
    // SAVE SECRET
    //
    // IMPORTANT:
    // 2FA IS NOT ENABLED YET.
    //
    // User still needs to verify the code.
    // --------------------------------------------------------

    admin.twoFactorSecret =
      secret;

    await admin.save();

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    return res.json({
      success: true,

      message:
        "2FA setup generated successfully",

      data: {
        secret,
        uri,
        qrCode,

        issuer: TWO_FACTOR_ISSUER,

        account:
          admin.email ||
          admin.username,
      },
    });
  } catch (error) {
    console.error(
      "Setup 2FA error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to setup 2FA",
    });
  }
};

// ============================================================
// ENABLE 2FA
// ============================================================

export const enableTwoFactor = async (
  req,
  res
) => {
  try {
    const {
      code,
    } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message:
          "2FA verification code is required",
      });
    }

    const admin =
      await Admin.findById(
        req.user._id
      ).select(
        "+twoFactorSecret"
      );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    if (
      admin.twoFactorEnabled
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Two-factor authentication is already enabled",
      });
    }

    if (
      !admin.twoFactorSecret
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please start 2FA setup first",
      });
    }

    const normalizedCode =
      String(code)
        .replace(/\s/g, "")
        .trim();

    if (
      !/^\d{6}$/.test(
        normalizedCode
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "2FA code must contain 6 digits",
      });
    }

    // --------------------------------------------------------
    // VERIFY FIRST
    // --------------------------------------------------------

    const verification =
      await verify({
        secret:
          admin.twoFactorSecret,

        token:
          normalizedCode,
      });

    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid authentication code",
      });
    }

    // --------------------------------------------------------
    // ENABLE
    // --------------------------------------------------------

    admin.twoFactorEnabled =
      true;

    await admin.save();

    // --------------------------------------------------------
    // AUDIT
    // --------------------------------------------------------

    await AuditLog.create({
      admin: admin._id,

      action: "UPDATE",

      resource: "ADMIN",

      resourceId: admin._id,

      description:
        "Two-factor authentication enabled",

      ipAddress: req.ip,

      userAgent:
        req.get("user-agent"),
    });

    return res.json({
      success: true,

      message:
        "Two-factor authentication enabled successfully",

      data: {
        twoFactorEnabled: true,
        admin: getAdminResponse(admin),
      },
    });
  } catch (error) {
    console.error(
      "Enable 2FA error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to enable 2FA",
    });
  }
};

// ============================================================
// DISABLE 2FA
// ============================================================

export const disableTwoFactor = async (
  req,
  res
) => {
  try {
    const {
      code,
      password,
    } = req.body;

    if (!code || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Password and 2FA code are required",
      });
    }

    const admin =
      await Admin.findById(
        req.user._id
      )
        .select(
          "+password +twoFactorSecret"
        );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    if (
      !admin.twoFactorEnabled ||
      !admin.twoFactorSecret
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Two-factor authentication is not enabled",
      });
    }

    // --------------------------------------------------------
    // VERIFY PASSWORD
    // --------------------------------------------------------

    const passwordMatches =
      await bcrypt.compare(
        password,
        admin.password
      );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid password",
      });
    }

    // --------------------------------------------------------
    // VERIFY 2FA
    // --------------------------------------------------------

    const normalizedCode =
      String(code)
        .replace(/\s/g, "")
        .trim();

    const verification =
      await verify({
        secret:
          admin.twoFactorSecret,

        token:
          normalizedCode,
      });

    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid authentication code",
      });
    }

    // --------------------------------------------------------
    // DISABLE
    // --------------------------------------------------------

    admin.twoFactorEnabled =
      false;

    admin.twoFactorSecret =
      null;

    await admin.save();

    // --------------------------------------------------------
    // AUDIT
    // --------------------------------------------------------

    await AuditLog.create({
      admin: admin._id,

      action: "UPDATE",

      resource: "ADMIN",

      resourceId: admin._id,

      description:
        "Two-factor authentication disabled",

      ipAddress: req.ip,

      userAgent:
        req.get("user-agent"),
    });

    return res.json({
      success: true,

      message:
        "Two-factor authentication disabled successfully",

      data: {
        admin: getAdminResponse(admin),

        twoFactorEnabled: false,
      },
    });
  } catch (error) {
    console.error(
      "Disable 2FA error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to disable 2FA",
    });
  }
};

// ============================================================
// GET CURRENT AUTHENTICATED ADMIN
// ============================================================

export const getCurrentAdmin = async (
  req,
  res
) => {
  try {
    const admin =
      await Admin.findById(
        req.user._id
      ).select(
        "-password -twoFactorSecret"
      );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    if (admin.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "This account is inactive",
      });
    }

    return res.json({
      success: true,

      data: admin,
    });
  } catch (error) {
    console.error(
      "Get current admin error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to retrieve account",
    });
  }
};

// ============================================================
// LOGOUT
// ============================================================

export const logout = async (
  req,
  res
) => {
  try {
    await AuditLog.create({
      admin: req.user._id,

      action: "LOGOUT",

      resource: "ADMIN",

      resourceId: req.user._id,

      description:
        "Admin logged out",

      ipAddress: req.ip,

      userAgent:
        req.get("user-agent"),
    });

    return res.json({
      success: true,
      message:
        "Logout successful",
    });
  } catch (error) {
    console.error(
      "Logout error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Logout failed",
    });
  }
};