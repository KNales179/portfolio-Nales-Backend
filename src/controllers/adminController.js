import bcrypt from "bcryptjs";
import Admin from "../models/Admin.js";
import AuditLog from "../models/AuditLog.js";

import {
    verify,
} from "otplib";


// ============================================================
// GET MY PROFILE
// ============================================================

export const getMyProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user._id).select(
      "-password -twoFactorSecret"
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    res.json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error("Get my profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve profile",
    });
  }
};

// ============================================================
// UPDATE MY PROFILE
// ============================================================

export const updateMyProfile = async (req, res) => {
  try {
    const allowedFields = [
      "fullName",
      "email",
      "phone",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const admin = await Admin.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password -twoFactorSecret");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    await AuditLog.create({
      admin: req.user._id,
      action: "PROFILE_UPDATE",
      resource: "PROFILE",
      resourceId: admin._id,
      description: "Admin updated their own profile",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: admin,
    });
  } catch (error) {
    console.error("Update my profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

// ============================================================
// CHANGE MY USERNAME
// ============================================================

export const changeMyUsername = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({
        success: false,
        message: "Username is required",
      });
    }

    const newUsername = username.trim().toLowerCase();

    const existingAdmin = await Admin.findOne({
      username: newUsername,
      _id: { $ne: req.user._id },
    });

    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        message: "Username already exists",
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.user._id,
      { username: newUsername },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password -twoFactorSecret");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    await AuditLog.create({
      admin: req.user._id,
      action: "UPDATE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: "Admin changed their username",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Username changed successfully",
      data: admin,
    });
  } catch (error) {
    console.error("Change username error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to change username",
    });
  }
};

// ============================================================
// CHANGE MY PASSWORD
// ============================================================

export const changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be at least 8 characters long",
      });
    }

    const admin = await Admin.findById(req.user._id).select(
      "+password"
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      admin.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const samePassword = await bcrypt.compare(
      newPassword,
      admin.password
    );

    if (samePassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be different from your current password",
      });
    }

    admin.password = await bcrypt.hash(newPassword, 12);
    admin.mustChangePassword = false;

    await admin.save();

    await AuditLog.create({
      admin: req.user._id,
      action: "PASSWORD_CHANGE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: "Admin changed their password",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
};

// ============================================================
// COMPLETE FIRST LOGIN
// ============================================================

export const completeFirstLogin = async (req, res) => {
  try {
    const {
      username,
      fullName,
      email,
      phone,
      newPassword,
    } = req.body;

    if (!username || !fullName || !email || !newPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Username, full name, email and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be at least 8 characters long",
      });
    }

    const newUsername = username.trim().toLowerCase();

    const existingAdmin = await Admin.findOne({
      username: newUsername,
      _id: { $ne: req.user._id },
    });

    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        message: "Username already exists",
      });
    }

    const admin = await Admin.findById(req.user._id).select(
      "+password"
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    if (!admin.mustChangePassword) {
      return res.status(400).json({
        success: false,
        message:
          "First-login setup has already been completed",
      });
    }

    admin.username = newUsername;
    admin.fullName = fullName.trim();
    admin.email = email.trim().toLowerCase();
    admin.phone = phone?.trim() || null;
    admin.password = await bcrypt.hash(newPassword, 12);
    admin.mustChangePassword = false;

    await admin.save();

    await AuditLog.create({
      admin: admin._id,
      action: "PROFILE_UPDATE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: "Admin completed first-login account setup",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    const safeAdmin = await Admin.findById(admin._id).select(
      "-password -twoFactorSecret"
    );

    res.json({
      success: true,
      message: "Account setup completed successfully",
      data: safeAdmin,
    });
  } catch (error) {
    console.error("Complete first login error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to complete account setup",
    });
  }
};

// ============================================================
// SUPER ADMIN - GET ALL ADMINS
// ============================================================

export const getAdmins = async (req, res) => {
  try {
    const admins = await Admin.find()
      .select("-password -twoFactorSecret")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: admins.length,
      data: admins,
    });
  } catch (error) {
    console.error("Get admins error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve admins",
    });
  }
};

// ============================================================
// SUPER ADMIN - GET SINGLE ADMIN
// ============================================================

export const getAdminById = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id).select(
      "-password -twoFactorSecret"
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    res.json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error("Get admin error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve admin",
    });
  }
};

// ============================================================
// SUPER ADMIN - CREATE ADMIN
// ============================================================

export const createAdmin = async (req, res) => {
  try {
    const {
      fullName,
      username,
      email,
      temporaryPassword,
      role = "ADMIN",
    } = req.body;

    if (!fullName || !username || !temporaryPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, username and temporary password are required",
      });
    }

    if (!["ADMIN"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid admin role",
      });
    }

    if (temporaryPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Temporary password must be at least 8 characters long",
      });
    }

    const normalizedUsername = username.trim().toLowerCase();

    const existingAdmin = await Admin.findOne({
      username: normalizedUsername,
    });

    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        message: "Username already exists",
      });
    }

    const admin = await Admin.create({
      fullName: fullName.trim(),
      username: normalizedUsername,
      email: email?.trim().toLowerCase() || null,
      password: await bcrypt.hash(temporaryPassword, 12),
      role,
      status: "ACTIVE",
      mustChangePassword: true,
      createdBy: req.user._id,
    });

    await AuditLog.create({
      admin: req.user._id,
      action: "CREATE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: `Created admin account: ${admin.username}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      success: true,
      message:
        "Admin account created successfully. The account must complete first login.",
      data: {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        status: admin.status,
        mustChangePassword: admin.mustChangePassword,
      },
    });
  } catch (error) {
    console.error("Create admin error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create admin account",
    });
  }
};

// ============================================================
// SUPER ADMIN - UPDATE ADMIN
// ============================================================

export const updateAdmin = async (req, res) => {
  try {
    const allowedFields = [
      "fullName",
      "username",
      "email",
      "phone",
      "role",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (updates.username) {
      updates.username = updates.username.trim().toLowerCase();

      const existingAdmin = await Admin.findOne({
        username: updates.username,
        _id: { $ne: req.params.id },
      });

      if (existingAdmin) {
        return res.status(409).json({
          success: false,
          message: "Username already exists",
        });
      }
    }

    if (
      updates.role &&
      !["ADMIN"].includes(updates.role)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid admin role",
      });
    }

    if (
      req.body.password ||
      req.body.newPassword ||
      req.body.temporaryPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Password cannot be changed through this endpoint",
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password -twoFactorSecret");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    await AuditLog.create({
      admin: req.user._id,
      action: "UPDATE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: `Updated admin account: ${admin.username}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Admin account updated successfully",
      data: admin,
    });
  } catch (error) {
    console.error("Update admin error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update admin",
    });
  }
};

// ============================================================
// SUPER ADMIN - CHANGE ADMIN STATUS
// ============================================================

export const updateAdminStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot change your own account status here",
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select("-password -twoFactorSecret");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    await AuditLog.create({
      admin: req.user._id,
      action: status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: `Admin account ${status.toLowerCase()}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: `Admin account ${status.toLowerCase()} successfully`,
      data: admin,
    });
  } catch (error) {
    console.error("Update admin status error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update admin status",
    });
  }
};

// ============================================================
// SUPER ADMIN - DELETE ADMIN
// ============================================================

export const deleteAdmin = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const admin = await Admin.findByIdAndDelete(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found",
      });
    }

    await AuditLog.create({
      admin: req.user._id,
      action: "DELETE",
      resource: "ADMIN",
      resourceId: admin._id,
      description: `Deleted admin account: ${admin.username}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Admin account deleted successfully",
    });
  } catch (error) {
    console.error("Delete admin error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete admin",
    });
  }
};

// ============================================================
// RESET PASSWORD USING 2FA
// ============================================================

export const resetPasswordWithTwoFactor = async (
    req,
    res
) => {
    try {
        const {
            code,
            newPassword,
        } = req.body;

        // ----------------------------------------------------
        // VALIDATION
        // ----------------------------------------------------

        if (!code || !newPassword) {
            return res.status(400).json({
                success: false,
                message:
                    "2FA code and new password are required",
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 8 characters long",
            });
        }

        const normalizedCode =
            String(code)
                .replace(/\s/g, "")
                .trim();

        if (!/^\d{6}$/.test(normalizedCode)) {
            return res.status(400).json({
                success: false,
                message:
                    "2FA code must contain 6 digits",
            });
        }

        // ----------------------------------------------------
        // GET AUTHENTICATED ADMIN
        // ----------------------------------------------------

        const admin =
            await Admin.findById(
                req.user._id
            ).select(
                "+password +twoFactorSecret"
            );

        if (!admin) {
            return res.status(404).json({
                success: false,
                message:
                    "Admin account not found",
            });
        }

        // ----------------------------------------------------
        // CHECK STATUS
        // ----------------------------------------------------

        if (admin.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message:
                    "This account is inactive",
            });
        }

        // ----------------------------------------------------
        // 2FA MUST BE ENABLED
        // ----------------------------------------------------

        if (
            !admin.twoFactorEnabled ||
            !admin.twoFactorSecret
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "Two-factor authentication must be enabled to reset your password",
            });
        }

        // ----------------------------------------------------
        // VERIFY 2FA
        // ----------------------------------------------------

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

                action: "UPDATE",

                resource: "ADMIN",

                resourceId: admin._id,

                description:
                    "Password reset failed due to invalid 2FA code",

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

        // ----------------------------------------------------
        // HASH NEW PASSWORD
        // ----------------------------------------------------

        const hashedPassword =
            await bcrypt.hash(
                newPassword,
                12
            );

        admin.password =
            hashedPassword;

        admin.mustChangePassword =
            false;

        await admin.save();

        // ----------------------------------------------------
        // AUDIT
        // ----------------------------------------------------

        await AuditLog.create({
            admin: admin._id,

            action: "UPDATE",

            resource: "ADMIN",

            resourceId: admin._id,

            description:
                "Administrator password reset using 2FA",

            ipAddress: req.ip,

            userAgent:
                req.get("user-agent"),
        });

        // ----------------------------------------------------
        // RESPONSE
        // ----------------------------------------------------

        return res.json({
            success: true,

            message:
                "Password reset successfully",
        });

    } catch (error) {
        console.error(
            "Reset password error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to reset password",
        });
    }
};