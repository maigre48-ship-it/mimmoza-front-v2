import proj4 from "proj4";

// EPSG:2154 – Lambert-93
proj4.defs(
  "EPSG:2154",
  "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 " +
    "+x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs"
);

export function wgs84ToLambert93(lon: number, lat: number) {
  const [x, y] = proj4("EPSG:4326", "EPSG:2154", [lon, lat]);
  return { x, y };
}
