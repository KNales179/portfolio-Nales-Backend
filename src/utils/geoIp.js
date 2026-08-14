import { Reader } from "@maxmind/geoip2-node";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databasePath = path.join(
    __dirname,
    "../config/GeoLite2-City.mmdb"
);

let reader = null;

// ============================================================
// LOAD DATABASE
// ============================================================

const getReader = async () => {
    if (!reader) {
        reader = await Reader.open(
            databasePath
        );
    }

    return reader;
};

// ============================================================
// LOOKUP IP LOCATION
// ============================================================

export const getIpLocation = async (
    ipAddress
) => {
    try {
        if (!ipAddress) {
            return null;
        }

        // Localhost cannot be geolocated.
        if (
            ipAddress === "::1" ||
            ipAddress === "127.0.0.1"
        ) {
            return null;
        }

        const geoReader =
            await getReader();

        const result =
            geoReader.city(ipAddress);

        return {
            country:
                result.country?.names?.en ||
                null,

            countryCode:
                result.country?.isoCode ||
                null,

            region:
                result.subdivisions?.[0]?.names
                    ?.en ||
                null,

            city:
                result.city?.names?.en ||
                null,

            latitude:
                result.location?.latitude ||
                null,

            longitude:
                result.location?.longitude ||
                null,

            accuracyRadius:
                result.location?.accuracyRadius ||
                null,
        };
    } catch (error) {
        console.error(
            "IP geolocation lookup failed:",
            error.message
        );

        return null;
    }
};