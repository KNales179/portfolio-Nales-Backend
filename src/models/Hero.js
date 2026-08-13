import mongoose from "mongoose";

const heroSchema = new mongoose.Schema(
    {
        headline: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },

        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },

        profileImage: {
            type: String,
            default: null,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model("Hero", heroSchema);