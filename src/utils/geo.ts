const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_LAT_DEGREE = 111_320;

/**
 * Computes exact great-circle distance between two WGS84 points in meters.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const lat1Rad = lat1 * DEG_TO_RAD;
  const lat2Rad = lat2 * DEG_TO_RAD;

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a =
    sinHalfLat * sinHalfLat + Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Computes a fast lat/lon bounding box for spatial pre-filtering before Haversine.
 */
export function boundingBox(
  lat: number,
  lon: number,
  radiusMeters: number,
): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const latDelta = radiusMeters / METERS_PER_LAT_DEGREE;
  const cosLat = Math.max(0.01, Math.cos(lat * DEG_TO_RAD));
  const lonDelta = radiusMeters / (METERS_PER_LAT_DEGREE * cosLat);

  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
  };
}

/**
 * Parses a decimal WGS84 coordinate from raw API strings/numbers, returning null for zero/invalid values.
 */
export function parseCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num === 0) {
    return null;
  }
  return num;
}
