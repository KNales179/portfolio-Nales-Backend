import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";

import connectDB from "../config/database.js";
import {
    Skill,
    JourneyMilestone,
    Award,
    Hobby,
    Certificate,
    ContactLink,
    Strength,
    SiteText,
} from "../models/contentModels.js";


// ============================================================
// SEED CONTENT
// ============================================================
//
//   npm run seed:content            (skip types that have rows)
//   npm run seed:content -- --force (overwrite by natural key)
//
// Natural keys: skills.name, contactLinks.label, everything
// else .title.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, "content.seed.json");
const force = process.argv.includes("--force");


const seedList = async (Model, rows, keyField) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
        const existing = await Model.findOne({
            [keyField]: row[keyField],
        });

        if (existing && !force) {
            skipped += 1;
            continue;
        }

        if (existing) {
            Object.assign(existing, row);
            await existing.save();
            updated += 1;
        } else {
            await Model.create(row);
            created += 1;
        }
    }

    return { created, updated, skipped };
};


const run = async () => {
    await connectDB();

    const seed = JSON.parse(
        fs.readFileSync(seedPath, "utf8")
    );

    const report = {};

    report.skills = await seedList(
        Skill,
        seed.skills,
        "name"
    );
    report.journey = await seedList(
        JourneyMilestone,
        seed.journey,
        "title"
    );
    report.awards = await seedList(
        Award,
        seed.awards,
        "title"
    );
    report.strengths = await seedList(
        Strength,
        seed.strengths,
        "title"
    );
    report.hobbies = await seedList(
        Hobby,
        seed.hobbies,
        "title"
    );
    report.certificates = await seedList(
        Certificate,
        seed.certificates,
        "title"
    );
    report.contactLinks = await seedList(
        ContactLink,
        seed.contactLinks,
        "label"
    );

    // site text singletons
    for (const [key, values] of Object.entries(
        seed.text || {}
    )) {
        const existing = await SiteText.findOne({ key });

        if (existing && !force) {
            report[`text:${key}`] = "skipped";
            continue;
        }

        if (existing) {
            existing.values = values;
            existing.markModified("values");
            await existing.save();
            report[`text:${key}`] = "updated";
        } else {
            await SiteText.create({ key, values });
            report[`text:${key}`] = "created";
        }
    }

    console.log("Content seed complete:");
    for (const [name, result] of Object.entries(report)) {
        console.log(
            ` - ${name}:`,
            typeof result === "string"
                ? result
                : `created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`
        );
    }

    await mongoose.disconnect();
};


run().catch((error) => {
    console.error("Content seed failed:", error);
    process.exit(1);
});
