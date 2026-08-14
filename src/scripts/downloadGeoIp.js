import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databasePath = path.join(
    __dirname,
    "../config/GeoLite2-City.mmdb"
);

const databaseUrl =
    process.env.GEOIP_DATABASE_URL ||
    "https://github.com/KNales179/portfolio-Nales-Backend/releases/download/geoip-2026-08/GeoLite2-City.mmdb";

if (!databaseUrl) {
    console.error(
        "GEOIP_DATABASE_URL environment variable is missing."
    );

    process.exit(1);
}

const downloadFile = (url, destination) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destination);

        https.get(url, (response) => {
            // Follow GitHub redirects
            if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                file.close();
                fs.unlinkSync(destination);

                return downloadFile(
                    response.headers.location,
                    destination
                )
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destination);

                return reject(
                    new Error(
                        `Download failed with status ${response.statusCode}`
                    )
                );
            }

            response.pipe(file);

            file.on("finish", () => {
                file.close(resolve);
            });
        }).on("error", (error) => {
            file.close();

            if (fs.existsSync(destination)) {
                fs.unlinkSync(destination);
            }

            reject(error);
        });
    });
};

const start = async () => {
    try {
        const configDirectory = path.dirname(
            databasePath
        );

        fs.mkdirSync(configDirectory, {
            recursive: true,
        });

        console.log(
            "Downloading GeoIP database..."
        );

        await downloadFile(
            databaseUrl,
            databasePath
        );

        console.log(
            "GeoIP database downloaded successfully."
        );

        console.log(
            `Location: ${databasePath}`
        );
    } catch (error) {
        console.error(
            "Failed to download GeoIP database:",
            error
        );

        process.exit(1);
    }
};

start();