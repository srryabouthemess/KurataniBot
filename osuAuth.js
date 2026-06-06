const axios = require('axios');

async function getOsuToken() {
  const response = await axios.post('https://osu.ppy.sh/oauth/token', {
    client_id: process.env.OSU_CLIENT_ID,
    client_secret: process.env.OSU_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'public'
  });

  return response.data.access_token;
}

module.exports = getOsuToken;