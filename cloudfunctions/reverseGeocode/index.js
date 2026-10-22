const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAP_KEY = 'PYUBZ-TB23A-EJLKS-CJ5E6-2QVPK-FTB2Z';

function reverseGeocode(latitude, longitude) {
  return new Promise((resolve) => {
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${latitude},${longitude}&key=${MAP_KEY}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.status === 0 && json.result) {
            const r = json.result;
            const name = (r.formatted_addresses && r.formatted_addresses.recommend)
              || (r.pois && r.pois[0] && r.pois[0].title)
              || (r.address_component && (r.address_component.city + r.address_component.district))
              || '';
            resolve({ name });
          } else {
            resolve({ name: '' });
          }
        } catch (e) {
          resolve({ name: '' });
        }
      });
    }).on('error', () => {
      resolve({ name: '' });
    });
  });
}

exports.main = async (event) => {
  const { latitude, longitude } = event;
  console.log('[reverseGeocode] input', latitude, longitude);
  const result = await reverseGeocode(latitude, longitude);
  console.log('[reverseGeocode] result', JSON.stringify(result));
  return result;
};
