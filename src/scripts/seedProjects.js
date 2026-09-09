import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";

import connectDB from "../config/database.js";
import Project from "../models/Project.js";


// ============================================================
// SEED PROJECTS
// ============================================================
//
// One-time (idempotent) import of the original hand-written
// project data into the database.
//
//   npm run seed:projects
//
// Matching is by name: an existing project with the same name
// is left untouched unless --force is passed, in which case its
// content fields are overwritten from the seed file.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const seedPath = path.join(__dirname, "projects.seed.json");

const force = process.argv.includes("--force");


const run = async () => {
    await connectDB();

    const seed = JSON.parse(
        fs.readFileSync(seedPath, "utf8")
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of seed) {
        const existing = await Project.findOne({
            name: entry.name,
        });

        if (existing && !force) {
            skipped += 1;
            continue;
        }

        const fields = {
            name: entry.name,
            type: entry.type || "",
            description: entry.description || "",
            layout: entry.layout || "portrait",
            status: entry.status || "complete",
            github: entry.github || "",
            liveLink: entry.liveLink || "",
            demoLink: entry.demoLink || "",
            image: entry.image || "",
            technologies: entry.technologies || [],
            notes: entry.notes || {
                learned: [],
                challenges: [],
                technical: [],
                reflection: [],
            },
            descriptions: entry.descriptions || [],
            order: entry.order || 0,
        };

        if (existing) {
            Object.assign(existing, fields);
            await existing.save();
            updated += 1;
        } else {
            await Project.create(fields);
            created += 1;
        }
    }

    console.log(
        `Projects seed complete — created ${created}, updated ${updated}, skipped ${skipped}.`
    );

    await mongoose.disconnect();
};


run().catch((error) => {
    console.error("Projects seed failed:", error);
    process.exit(1);
});
