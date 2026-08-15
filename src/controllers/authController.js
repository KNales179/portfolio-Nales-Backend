import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import AuditLog from "../models/AuditLog.js";
import AdminSession from "../models/AdminSession.js";
import generateToken from "../utils/generateToken.js";
import crypto from "crypto";
import {
  getIpLocation,
} from "../utils/geoIp.js";

import {
  generateSecret,
  generateURI,
  verify,
} from "otplib";

import QRCode from "qrcode";

const sessionId = crypto.randomUUID();

// ============================================================
// CONSTANTS
// ============================================================

const TWO_FACTOR_CHALLENGE_EXPIRES_IN = "5m";

const TWO_FACTOR_RENEWAL_MS =
  8 * 60 * 60 * 1000;

const TRUSTED_DEVICE_INACTIVE_MS =
  30 * 24 * 60 * 60 * 1000;

const TWO_FACTOR_ISSUER =
  process.env.TWO_FACTOR_ISSUER ||
  "Portfolio Admin";


// ============================================================
// LOGIN BRUTE-FORCE PROTECTION
// ============================================================

const MAX_FAILED_LOGIN_ATTEMPTS = 12;

const LOGIN_LOCK_DURATION_MS =
  30 * 60 * 1000;

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

const removeInactiveTrustedDevices = async (admin) => {
  const now = Date.now();

  const activeTrustedDevices =
    admin.trustedDevices.filter((device) => {
      const lastUsedAt =
        device.lastUsedAt
          ? new Date(device.lastUsedAt).getTime()
          : 0;

      return (
        now - lastUsedAt <
        TRUSTED_DEVICE_INACTIVE_MS
      );
    });

  const removedCount =
    admin.trustedDevices.length -
    activeTrustedDevices.length;

  if (removedCount > 0) {
    admin.trustedDevices =
      activeTrustedDevices;

    await admin.save();
  }

  return removedCount;
};

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
    // CHECK ACCOUNT LOCK
    // --------------------------------------------------------

    if (
      admin.lockUntil &&
      admin.lockUntil > new Date()
    ) {
      const remainingMinutes = Math.ceil(
        (admin.lockUntil.getTime() - Date.now()) /
        60000
      );

      return res.status(423).json({
        success: false,
        message:
          `Account temporarily locked due to multiple failed login attempts. Try again in ${remainingMinutes} minute(s).`,
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
      admin.failedLoginAttempts =
        (admin.failedLoginAttempts || 0) + 1;

      // ----------------------------------------------------
      // LOCK ACCOUNT AFTER MAXIMUM FAILED ATTEMPTS
      // ----------------------------------------------------

      if (
        admin.failedLoginAttempts >=
        MAX_FAILED_LOGIN_ATTEMPTS
      ) {
        admin.lockUntil = new Date(
          Date.now() +
          LOGIN_LOCK_DURATION_MS
        );

        await admin.save();

        await AuditLog.create({
          admin: admin._id,

          action: "LOGIN_FAILED",

          resource: "ADMIN",

          resourceId: admin._id,

          description:
            "Account locked after multiple failed login attempts",

          ipAddress: req.ip,

          userAgent:
            req.get("user-agent"),
        });

        return res.status(423).json({
          success: false,
          message:
            "Account temporarily locked due to multiple failed login attempts. Please try again later.",
        });
      }

      await admin.save();

      await AuditLog.create({
        admin: admin._id,

        action: "LOGIN_FAILED",

        resource: "ADMIN",

        resourceId: admin._id,

        description:
          `Failed login attempt ${admin.failedLoginAttempts} of ${MAX_FAILED_LOGIN_ATTEMPTS}`,

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

    // --------------------------------------------------------
    // RESET FAILED LOGIN ATTEMPTS
    // --------------------------------------------------------

    if (
      admin.failedLoginAttempts > 0 ||
      admin.lockUntil
    ) {
      admin.failedLoginAttempts = 0;
      admin.lockUntil = null;

      await admin.save();
    }

    // ========================================================
    // 2FA CHECK
    // ========================================================

    if (
      admin.twoFactorEnabled &&
      admin.twoFactorSecret
    ) {
      const deviceId =
        req.get("x-device-id");

      // ------------------------------------------------------
      // REMOVE TRUSTED DEVICES INACTIVE FOR 30 DAYS
      // ------------------------------------------------------

      await removeInactiveTrustedDevices(admin);

      // ------------------------------------------------------
      // CHECK TRUSTED DEVICE
      // ------------------------------------------------------

      const trustedDevice =
        deviceId
          ? admin.trustedDevices.find(
            (device) =>
              device.deviceId === deviceId
          )
          : null;

      // ------------------------------------------------------
      // DEVICE IS TRUSTED
      // ------------------------------------------------------

      if (trustedDevice) {
        const now = Date.now();

        const lastTwoFactorVerifiedAt =
          trustedDevice.lastTwoFactorVerifiedAt
            ? new Date(
              trustedDevice.lastTwoFactorVerifiedAt
            ).getTime()
            : 0;

        const twoFactorRenewalExpired =
          !lastTwoFactorVerifiedAt ||
          now - lastTwoFactorVerifiedAt >=
          TWO_FACTOR_RENEWAL_MS;

        // ----------------------------------------------------
        // TRUSTED DEVICE + 2FA STILL VALID
        // ----------------------------------------------------

        if (!twoFactorRenewalExpired) {
          trustedDevice.lastUsedAt =
            new Date();

          await admin.save();

          console.log(
            "Trusted device accepted without 2FA"
          );

          // Continue to normal session creation below.
        }

        // ----------------------------------------------------
        // TRUSTED DEVICE + 2FA RENEWAL EXPIRED
        // ----------------------------------------------------

        else {
          const challengeToken =
            jwt.sign(
              {
                id: admin._id.toString(),
                type: "2FA_CHALLENGE",
                purpose: "RENEWAL",
                deviceId,
              },

              process.env.JWT_SECRET,

              {
                expiresIn:
                  TWO_FACTOR_CHALLENGE_EXPIRES_IN,
              }
            );

          await AuditLog.create({
            admin: admin._id,

            action:
              "LOGIN_2FA_REQUIRED",

            resource: "ADMIN",

            resourceId: admin._id,

            description:
              "Trusted device 2FA renewal required",

            ipAddress: req.ip,

            userAgent:
              req.get("user-agent"),
          });

          return res.json({
            success: true,

            requiresTwoFactor: true,

            message:
              "2FA renewal required",

            data: {
              challengeToken,

              username:
                admin.username,
            },
          });
        }
      }

      // ------------------------------------------------------
      // DEVICE IS NOT TRUSTED
      // ------------------------------------------------------

      else {
        const challengeToken =
          jwt.sign(
            {
              id: admin._id.toString(),
              type: "2FA_CHALLENGE",
              purpose: "VERIFICATION",
              deviceId,
            },

            process.env.JWT_SECRET,

            {
              expiresIn:
                TWO_FACTOR_CHALLENGE_EXPIRES_IN,
            }
          );

        await AuditLog.create({
          admin: admin._id,

          action:
            "LOGIN_2FA_REQUIRED",

          resource: "ADMIN",

          resourceId: admin._id,

          description:
            "Untrusted device 2FA verification required",

          ipAddress: req.ip,

          userAgent:
            req.get("user-agent"),
        });

        return res.json({
          success: true,

          requiresTwoFactor: true,

          message:
            "Two-factor authentication required",

          data: {
            challengeToken,

            username:
              admin.username,
          },
        });
      }
    }

    // ========================================================
    // NORMAL LOGIN WHEN 2FA IS DISABLED
    // ========================================================

    const sessionId = crypto.randomUUID();

    const deviceName =
      req.get("x-device-name") ||
      "Unknown Device";

    const userAgent =
      req.get("user-agent") ||
      "Unknown User Agent";

    const ipLocation =
      await getIpLocation(req.ip);

    console.log("===== GEOIP DEBUG =====");
    console.log("req.ip:", req.ip);
    console.log(
      "x-forwarded-for:",
      req.get("x-forwarded-for")
    );
    console.log(
      "socket remote address:",
      req.socket.remoteAddress
    );
    console.log("======================");

    const session = await AdminSession.create({
      admin: admin._id,

      sessionId,

      deviceId:
        req.get("x-device-id") ||
        sessionId,

      deviceName,

      browser:
        req.get("x-browser") ||
        "Unknown Browser",

      operatingSystem:
        req.get("x-operating-system") ||
        "Unknown OS",

      ipAddress: req.ip,

      location: ipLocation,

      userAgent,

      firstLoginAt: new Date(),

      lastUsedAt: new Date(),

      expiresAt: new Date(
        Date.now() +
        24 * 60 * 60 * 1000
      ),
    });

    admin.lastLogin = new Date();

    admin.lastLoginIP = req.ip;

    await admin.save();

    const token =
      generateToken(
        admin,
        session.sessionId
      );

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
    // VALIDATE CHALLENGE PURPOSE
    // --------------------------------------------------------


    if (
      !["VERIFICATION", "RENEWAL"].includes(
        decoded.purpose
      )
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid 2FA challenge purpose",
      });
    }

    const deviceId =
      req.get("x-device-id");

    if (
      decoded.deviceId &&
      decoded.deviceId !== deviceId
    ) {
      return res.status(401).json({
        success: false,
        message:
          "This 2FA challenge belongs to a different device",
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

    const deviceId =
      req.get("x-device-id");

    const trustedDevice =
      deviceId
        ? admin.trustedDevices.find(
          (device) =>
            device.deviceId === deviceId
        )
        : null;

    // --------------------------------------------------------
    // RENEW 2FA FOR EXISTING TRUSTED DEVICE
    // --------------------------------------------------------

    if (trustedDevice) {
      trustedDevice.lastUsedAt =
        new Date();

      trustedDevice.lastTwoFactorVerifiedAt =
        new Date();

      await admin.save();
    }

    // ========================================================
    // CREATE NORMAL LOGIN SESSION
    // ========================================================

    const sessionId = crypto.randomUUID();

    const deviceName =
      req.get("x-device-name") ||
      "Unknown Device";

    const userAgent =
      req.get("user-agent") ||
      "Unknown User Agent";

    const ipLocation =
      await getIpLocation(req.ip);

    console.log("===== GEOIP DEBUG =====");
    console.log("req.ip:", req.ip);
    console.log(
      "x-forwarded-for:",
      req.get("x-forwarded-for")
    );
    console.log(
      "socket remote address:",
      req.socket.remoteAddress
    );
    console.log("======================");

    const session =
      await AdminSession.create({
        admin: admin._id,

        sessionId,

        deviceId:
          req.get("x-device-id") ||
          sessionId,

        deviceName,

        browser:
          req.get("x-browser") ||
          "Unknown Browser",

        operatingSystem:
          req.get("x-operating-system") ||
          "Unknown OS",

        ipAddress: req.ip,

        userAgent,

        firstLoginAt: new Date(),

        lastUsedAt: new Date(),

        expiresAt: new Date(
          Date.now() +
          24 * 60 * 60 * 1000
        ),
      });

    admin.lastLogin = new Date();

    admin.lastLoginIP = req.ip;

    await admin.save();

    // --------------------------------------------------------
    // GENERATE REAL AUTH TOKEN
    // --------------------------------------------------------

    const token =
      generateToken(
        admin,
        session.sessionId
      );

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
// TRUST CURRENT DEVICE
// ============================================================

export const trustCurrentDevice = async (
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

    const deviceId =
      req.get("x-device-id");

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message:
          "Device ID is required",
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

    if (admin.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "Admin account is inactive",
      });
    }

    if (
      !admin.twoFactorEnabled ||
      !admin.twoFactorSecret
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Two-factor authentication must be enabled",
      });
    }

    // --------------------------------------------------------
    // REMOVE INACTIVE TRUSTED DEVICES
    // --------------------------------------------------------

    await removeInactiveTrustedDevices(admin);

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
    // VERIFY 2FA
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
          "TRUSTED_DEVICE_ADD_FAILED",

        resource: "ADMIN",

        resourceId: admin._id,

        description:
          "Failed 2FA verification while trusting device",

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

    // --------------------------------------------------------
    // DEVICE INFORMATION
    // --------------------------------------------------------

    const deviceName =
      req.get("x-device-name") ||
      "Unknown Device";

    const userAgent =
      req.get("user-agent") ||
      "Unknown User Agent";

    // --------------------------------------------------------
    // CHECK IF ALREADY TRUSTED
    // --------------------------------------------------------

    const existingDevice =
      admin.trustedDevices.find(
        (device) =>
          device.deviceId === deviceId
      );

    if (existingDevice) {
      existingDevice.deviceName =
        deviceName;

      existingDevice.ipAddress =
        req.ip;

      existingDevice.userAgent =
        userAgent;

      existingDevice.lastUsedAt =
        new Date();

      existingDevice.lastTwoFactorVerifiedAt =
        new Date();

      await admin.save();

      return res.json({
        success: true,

        message:
          "Device trust renewed successfully",

        data: {
          device:
            existingDevice,
        },
      });
    }

    // --------------------------------------------------------
    // ADD NEW TRUSTED DEVICE
    // --------------------------------------------------------

    const now = new Date();

    admin.trustedDevices.push({
      deviceId,

      deviceName,

      ipAddress:
        req.ip,

      userAgent,

      trustedAt:
        now,

      lastUsedAt:
        now,

      lastTwoFactorVerifiedAt:
        now,
    });

    await admin.save();

    // --------------------------------------------------------
    // AUDIT
    // --------------------------------------------------------

    await AuditLog.create({
      admin: admin._id,

      action: "CREATE",

      resource:
        "TRUSTED_DEVICE",

      resourceId:
        admin._id,

      description:
        `Trusted device added: ${deviceName}`,

      ipAddress:
        req.ip,

      userAgent:
        userAgent,
    });

    return res.status(201).json({
      success: true,

      message:
        "Device trusted successfully",

      data: {
        device:
          admin.trustedDevices[
          admin.trustedDevices.length - 1
          ],
      },
    });
  } catch (error) {
    console.error(
      "Trust current device error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to trust device",
    });
  }
};

// ============================================================
// GET TRUSTED DEVICES
// ============================================================

export const getTrustedDevices = async (
  req,
  res
) => {
  try {
    const admin =
      await Admin.findById(
        req.user._id
      );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    await removeInactiveTrustedDevices(
      admin
    );

    const currentDeviceId =
      req.get("x-device-id");

    const devices =
      admin.trustedDevices.map(
        (device) => ({
          deviceId:
            device.deviceId,

          deviceName:
            device.deviceName,

          ipAddress:
            device.ipAddress,

          userAgent:
            device.userAgent,

          trustedAt:
            device.trustedAt,

          lastUsedAt:
            device.lastUsedAt,

          lastTwoFactorVerifiedAt:
            device.lastTwoFactorVerifiedAt,

          isCurrentDevice:
            device.deviceId ===
            currentDeviceId,
        })
      );

    return res.json({
      success: true,

      data: {
        devices,
      },
    });
  } catch (error) {
    console.error(
      "Get trusted devices error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to retrieve trusted devices",
    });
  }
};

// ============================================================
// REMOVE OWN TRUSTED DEVICE
// ============================================================

export const removeTrustedDevice = async (
  req,
  res
) => {
  try {
    const {
      deviceId,
    } = req.params;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message:
          "Device ID is required",
      });
    }

    const admin =
      await Admin.findById(
        req.user._id
      );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    const deviceIndex =
      admin.trustedDevices.findIndex(
        (device) =>
          device.deviceId === deviceId
      );

    if (deviceIndex === -1) {
      return res.status(404).json({
        success: false,
        message:
          "Trusted device not found",
      });
    }

    const removedDevice =
      admin.trustedDevices[
      deviceIndex
      ];

    admin.trustedDevices.splice(
      deviceIndex,
      1
    );

    await admin.save();

    await AuditLog.create({
      admin: admin._id,

      action: "DELETE",

      resource:
        "TRUSTED_DEVICE",

      resourceId:
        admin._id,

      description:
        `Trusted device removed: ${removedDevice.deviceName}`,

      ipAddress:
        req.ip,

      userAgent:
        req.get("user-agent"),
    });

    return res.json({
      success: true,

      message:
        "Trusted device removed successfully",
    });
  } catch (error) {
    console.error(
      "Remove trusted device error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to remove trusted device",
    });
  }
};

// ============================================================
// SUPER ADMIN REMOVE TRUSTED DEVICE
// ============================================================

export const removeAdminTrustedDevice = async (
  req,
  res
) => {
  try {
    const {
      adminId,
      deviceId,
    } = req.params;

    if (!adminId || !deviceId) {
      return res.status(400).json({
        success: false,
        message:
          "Admin ID and device ID are required",
      });
    }

    const requestingAdmin =
      await Admin.findById(
        req.user._id
      );

    if (!requestingAdmin) {
      return res.status(404).json({
        success: false,
        message:
          "Requesting admin not found",
      });
    }

    if (
      requestingAdmin.role !==
      "SUPER_ADMIN"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only SUPER_ADMIN can remove another admin's trusted device",
      });
    }

    const admin =
      await Admin.findById(
        adminId
      );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message:
          "Admin account not found",
      });
    }

    const deviceIndex =
      admin.trustedDevices.findIndex(
        (device) =>
          device.deviceId === deviceId
      );

    if (deviceIndex === -1) {
      return res.status(404).json({
        success: false,
        message:
          "Trusted device not found",
      });
    }

    const removedDevice =
      admin.trustedDevices[
      deviceIndex
      ];

    admin.trustedDevices.splice(
      deviceIndex,
      1
    );

    await admin.save();

    await AuditLog.create({
      admin:
        requestingAdmin._id,

      action: "DELETE",

      resource:
        "TRUSTED_DEVICE",

      resourceId:
        admin._id,

      description:
        `SUPER_ADMIN removed trusted device ${removedDevice.deviceId} from admin ${admin.username}`,

      ipAddress:
        req.ip,

      userAgent:
        req.get("user-agent"),
    });

    return res.json({
      success: true,

      message:
        "Admin trusted device removed successfully",
    });
  } catch (error) {
    console.error(
      "Super admin remove trusted device error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to remove admin trusted device",
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
    const admin = await Admin.findById(
      req.user._id
    );

    if (admin) {
      admin.tokenVersion =
        (admin.tokenVersion || 0) + 1;

      await admin.save();
    }

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