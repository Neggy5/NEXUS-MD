// Links the bot auto-follows / requires users to join.
// Override via env vars if you ever want to change them without editing code.

const CHANNEL_LINK = process.env.FORCE_CHANNEL_LINK || 'https://whatsapp.com/channel/0029VbCoHP4Id7nGRtKYuA0A';
const GROUP_LINK = process.env.FORCE_GROUP_LINK || 'https://chat.whatsapp.com/GMHYNRFJhyiFhM5h5tE0FX?s=cl&p=a&ilr=0';

// FORCE_JOIN=false disables the group-membership gate entirely (channel auto-follow still happens).
const FORCE_JOIN_ENABLED = process.env.FORCE_JOIN !== 'false';

function extractChannelCode(link) {
  const m = link.match(/channel\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function extractGroupCode(link) {
  const m = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

module.exports = {
  CHANNEL_LINK,
  GROUP_LINK,
  FORCE_JOIN_ENABLED,
  CHANNEL_CODE: extractChannelCode(CHANNEL_LINK),
  GROUP_CODE: extractGroupCode(GROUP_LINK),
};
