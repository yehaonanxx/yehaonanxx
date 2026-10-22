function latToMercatorY(lat) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
}

function mercatorYToLat(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

function geoToPixel(lat, lng, region, canvasWidth, canvasHeight) {
  const { southwest, northeast } = region;
  const yM1 = latToMercatorY(southwest.latitude);
  const yM2 = latToMercatorY(northeast.latitude);
  const yM = latToMercatorY(lat);
  const x = ((lng - southwest.longitude) / (northeast.longitude - southwest.longitude)) * canvasWidth;
  const y = (1 - (yM - yM1) / (yM2 - yM1)) * canvasHeight;
  return { x, y };
}

function pixelToGeo(x, y, region, canvasWidth, canvasHeight) {
  const { southwest, northeast } = region;
  const yM1 = latToMercatorY(southwest.latitude);
  const yM2 = latToMercatorY(northeast.latitude);
  const lng = southwest.longitude + (x / canvasWidth) * (northeast.longitude - southwest.longitude);
  const yM = yM2 + (1 - y / canvasHeight) * (yM1 - yM2);
  const lat = mercatorYToLat(yM);
  return { latitude: lat, longitude: lng };
}

function metersToPixels(radiusMeters, region, canvasWidth, canvasHeight) {
  const { southwest, northeast } = region;
  const centerLat = (southwest.latitude + northeast.latitude) / 2;
  const yM1 = latToMercatorY(southwest.latitude);
  const yM2 = latToMercatorY(northeast.latitude);
  const yRange = yM2 - yM1;
  const latRad = centerLat * Math.PI / 180;
  const cosLat = Math.cos(latRad);
  const lngDegPerPixel = (northeast.longitude - southwest.longitude) / canvasWidth;
  const latDegPerPixel = mercatorYToLat(yM1 + yRange * (0.5 + 0.5 / canvasHeight)) - mercatorYToLat(yM1 + yRange * (0.5 - 0.5 / canvasHeight));
  const metersPerPxLng = 111320 * cosLat * lngDegPerPixel;
  const metersPerPxLat = 110574 * Math.abs(latDegPerPixel);
  const metersPerPixel = (metersPerPxLng + metersPerPxLat) / 2;
  return radiusMeters / metersPerPixel;
}

function roundCoordinate(value) {
  return Math.round(value * 10000) / 10000;
}

module.exports = {
  geoToPixel,
  pixelToGeo,
  metersToPixels,
  roundCoordinate
};
