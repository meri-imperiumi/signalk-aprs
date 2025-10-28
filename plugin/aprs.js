function formatLatitude(coord) {
  const degFloat = Math.abs(coord);
  const deg = String(Math.floor(degFloat)).padStart(2, '0');
  const minFloat = 60 * (degFloat - Math.floor(degFloat));
  const min = String(Math.floor(minFloat)).padStart(2, '0');
  const secFloat = 60 * (minFloat - Math.floor(minFloat));
  const sec = String(Math.floor(secFloat)).padStart(2, '0');
  const sign = coord > 0 ? 'N' : 'S';
  return `${deg}${min}.${sec}${sign}`;
}

function formatLongitude(coord) {
  const degFloat = Math.abs(coord);
  const deg = String(Math.floor(degFloat)).padStart(3, '0');
  const minFloat = 60 * (degFloat - Math.floor(degFloat));
  const min = String(Math.floor(minFloat)).padStart(2, '0');
  const secFloat = 60 * (minFloat - Math.floor(minFloat));
  const sec = String(Math.floor(secFloat)).padStart(2, '0');
  const sign = coord > 0 ? 'E' : 'W';
  return `${deg}${min}.${sec}${sign}`;
}

function formatAddress(obj) {
  if (!obj.ssid) {
    return obj.callsign;
  }
  return `${obj.callsign}-${obj.ssid}`;
}

module.exports = {
  formatLatitude,
  formatLongitude,
  formatAddress,
};
