const path = require('node:path');

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'islamic-tracker-super-secret-key-2026-secure',
  DB_PATH: process.env.NODE_ENV === 'production'
    ? '/data/tracker.db'
    : path.join(__dirname, '..', 'data', 'tracker.db'),
  DEFAULT_TIMEZONE: 'Asia/Kolkata',
  DEFAULT_ALLOWED_BACKDATE_DAYS: 7,
  PRAYERS: [
    { key: 'fajr', ml: 'സുബ്ഹ്', en: 'Fajr', order: 1 },
    { key: 'dhuhr', ml: 'ളുഹർ', en: 'Dhuhr', order: 2 },
    { key: 'asr', ml: 'അസർ', en: 'Asr', order: 3 },
    { key: 'maghrib', ml: 'മഗ്രിബ്', en: 'Maghrib', order: 4 },
    { key: 'isha', ml: 'ഇശാ', en: 'Isha', order: 5 }
  ],
  STATUSES: {
    COMPLETED: 'completed',
    NOT_COMPLETED: 'not_completed',
    NOT_RECORDED: 'not_recorded',
    EXCUSED: 'excused'
  }
};
