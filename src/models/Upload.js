import mongoose from "mongoose";

const uploadSchema = new mongoose.Schema(
  {
    // Admin who uploaded the file
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    // What this upload belongs to
    // Examples:
    // PROFILE_IMAGE
    // HERO_IMAGE
    // PROJECT_IMAGE
    // CERTIFICATE_IMAGE
    // AWARD_IMAGE
    type: {
      type: String,
      required: true,
      enum: [
        "PROFILE_IMAGE",
        "HERO_IMAGE",
        "PROJECT_IMAGE",
        "CERTIFICATE_IMAGE",
        "AWARD_IMAGE",
        "OTHER",
      ],
    },

    // Cloudinary information
    publicId: {
      type: String,
      required: true,
    },

    url: {
      type: String,
      required: true,
    },

    secureUrl: {
      type: String,
      required: true,
    },

    // Original uploaded filename
    originalName: {
      type: String,
      default: null,
    },

    // MIME type
    mimeType: {
      type: String,
      default: null,
    },

    // File size in bytes
    size: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Upload = mongoose.model("Upload", uploadSchema);

export default Upload;