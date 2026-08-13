import Upload from "../models/Upload.js";
import Admin from "../models/Admin.js";

// ============================================================
// PROFILE IMAGE
// ============================================================

// Upload / replace admin profile image
export const uploadProfileImage = async (req, res) => {
    try {
        // --------------------------------------------------------
        // Check file
        // --------------------------------------------------------

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No profile image provided",
            });
        }

        // --------------------------------------------------------
        // Get current admin
        // --------------------------------------------------------

        const admin = await Admin.findById(req.user._id);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin account not found",
            });
        }

        // --------------------------------------------------------
        // Save old public ID
        // --------------------------------------------------------

        const oldPublicId =
            admin.profileImage?.publicId || null;

        // --------------------------------------------------------
        // Upload new image to Cloudinary
        // --------------------------------------------------------

        const result = await new Promise((resolve, reject) => {
            const stream =
                req.app.locals.cloudinary.uploader.upload_stream(
                    {
                        folder: "portfolio/profile-images",
                        resource_type: "image",

                        transformation: [
                            {
                                width: 800,
                                height: 800,
                                crop: "limit",
                                quality: "auto",
                                fetch_format: "auto",
                            },
                        ],
                    },
                    (error, result) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(result);
                        }
                    }
                );

            stream.end(req.file.buffer);
        });

        // --------------------------------------------------------
        // Save new image information to Admin
        // --------------------------------------------------------

        admin.profileImage = {
            url: result.secure_url,
            publicId: result.public_id,
        };

        await admin.save();

        // --------------------------------------------------------
        // Delete old Cloudinary image
        // --------------------------------------------------------

        if (oldPublicId) {
            try {
                await req.app.locals.cloudinary.uploader.destroy(
                    oldPublicId,
                    {
                        resource_type: "image",
                    }
                );
            } catch (cloudinaryDeleteError) {
                console.error(
                    "Failed to delete old profile image from Cloudinary:",
                    cloudinaryDeleteError
                );

                // Do not fail the request.
                // The new profile image has already been saved.
            }
        }

        // --------------------------------------------------------
        // Response
        // --------------------------------------------------------

        return res.status(201).json({
            success: true,
            message:
                "Profile image uploaded successfully",
            data: {
                profileImage: {
                    url: result.secure_url,
                    publicId: result.public_id,
                },
            },
        });
    } catch (error) {
        console.error("Upload profile image error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to upload profile image",
            error: error,
        });
    }
};

// ============================================================
// DELETE PROFILE IMAGE
// ============================================================

export const deleteProfileImage = async (req, res) => {
    try {
        // --------------------------------------------------------
        // Get current admin
        // --------------------------------------------------------

        const admin = await Admin.findById(
            req.user._id
        );

        if (!admin) {
            return res.status(404).json({
                success: false,
                message:
                    "Admin account not found",
            });
        }

        // --------------------------------------------------------
        // Get current Cloudinary public ID
        // --------------------------------------------------------

        const publicId =
            admin.profileImage?.publicId || null;

        // --------------------------------------------------------
        // Delete image from Cloudinary
        // --------------------------------------------------------

        if (publicId) {
            try {
                await cloudinary.uploader.destroy(
                    publicId,
                    {
                        resource_type: "image",
                    }
                );
            } catch (cloudinaryError) {
                console.error(
                    "Cloudinary profile image deletion error:",
                    cloudinaryError
                );

                // Continue removing the reference
                // from the database.
            }
        }

        // --------------------------------------------------------
        // Remove image information from Admin
        // --------------------------------------------------------

        admin.profileImage = {
            url: null,
            publicId: null,
        };

        await admin.save();

        // --------------------------------------------------------
        // Response
        // --------------------------------------------------------

        return res.json({
            success: true,
            message:
                "Profile image deleted successfully",
            data: {
                profileImage: null,
            },
        });
    } catch (error) {
        console.error(
            "Delete profile image error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to delete profile image",
        });
    }
};

// ============================================================
// GENERAL IMAGE UPLOAD
// ============================================================

export const uploadImage = async (req, res) => {
    try {
        // --------------------------------------------------------
        // Check file
        // --------------------------------------------------------

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image file provided",
            });
        }

        // --------------------------------------------------------
        // Upload type
        // --------------------------------------------------------

        const uploadType =
            req.body.type || "OTHER";

        const allowedTypes = [
            "PROFILE_IMAGE",
            "HERO_IMAGE",
            "PROJECT_IMAGE",
            "CERTIFICATE_IMAGE",
            "AWARD_IMAGE",
            "OTHER",
        ];

        if (!allowedTypes.includes(uploadType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid upload type",
            });
        }

        // --------------------------------------------------------
        // Upload to Cloudinary
        // --------------------------------------------------------

        const result = await new Promise(
            (resolve, reject) => {
                const stream =
                    cloudinary.uploader.upload_stream(
                        {
                            folder: `portfolio/${uploadType.toLowerCase()}`,
                            resource_type: "image",
                        },
                        (error, result) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve(result);
                            }
                        }
                    );

                stream.end(req.file.buffer);
            }
        );

        // --------------------------------------------------------
        // Save upload record
        // --------------------------------------------------------

        const upload = await Upload.create({
            uploadedBy: req.user._id,
            type: uploadType,
            publicId: result.public_id,
            url: result.url,
            secureUrl: result.secure_url,
            originalName:
                req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
        });

        // --------------------------------------------------------
        // Response
        // --------------------------------------------------------

        return res.status(201).json({
            success: true,
            message:
                "Image uploaded successfully",
            data: upload,
        });
    } catch (error) {
        console.error(
            "Upload image error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to upload image",
        });
    }
};

// ============================================================
// GET UPLOAD
// ============================================================

export const getUpload = async (req, res) => {
    try {
        const upload =
            await Upload.findById(
                req.params.id
            ).populate(
                "uploadedBy",
                "username fullName"
            );

        if (!upload) {
            return res.status(404).json({
                success: false,
                message: "Upload not found",
            });
        }

        return res.json({
            success: true,
            data: upload,
        });
    } catch (error) {
        console.error(
            "Get upload error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to retrieve upload",
        });
    }
};

// ============================================================
// GET MY UPLOADS
// ============================================================

export const getMyUploads = async (req, res) => {
    try {
        const uploads =
            await Upload.find({
                uploadedBy: req.user._id,
            }).sort({
                createdAt: -1,
            });

        return res.json({
            success: true,
            count: uploads.length,
            data: uploads,
        });
    } catch (error) {
        console.error(
            "Get uploads error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to retrieve uploads",
        });
    }
};

// ============================================================
// DELETE GENERAL IMAGE
// ============================================================

export const deleteImage = async (req, res) => {
    try {
        const upload =
            await Upload.findById(
                req.params.id
            );

        if (!upload) {
            return res.status(404).json({
                success: false,
                message: "Upload not found",
            });
        }

        // --------------------------------------------------------
        // Check ownership
        // --------------------------------------------------------

        const isOwner =
            upload.uploadedBy.toString() ===
            req.user._id.toString();

        const isSuperAdmin =
            req.user.role === "SUPER_ADMIN";

        if (!isOwner && !isSuperAdmin) {
            return res.status(403).json({
                success: false,
                message:
                    "You are not allowed to delete this image",
            });
        }

        // --------------------------------------------------------
        // Delete from Cloudinary
        // --------------------------------------------------------

        await cloudinary.uploader.destroy(
            upload.publicId,
            {
                resource_type: "image",
            }
        );

        // --------------------------------------------------------
        // Delete database record
        // --------------------------------------------------------

        await Upload.findByIdAndDelete(
            upload._id
        );

        // --------------------------------------------------------
        // Response
        // --------------------------------------------------------

        return res.json({
            success: true,
            message:
                "Image deleted successfully",
        });
    } catch (error) {
        console.error(
            "Delete image error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to delete image",
        });
    }
};