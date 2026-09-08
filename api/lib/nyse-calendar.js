// Determines whether "today" (in US Eastern time) is a NYSE trading day:
// a weekday that isn't on the hand-maintained holiday list.
// Deliberately not using a live market-calendar API — see data/nyse-holidays.json.

const fs = require('fs');
const path = require('path');

const HOLIDAYS_PATH = path.join(__dirname, '..', '..', 'data', 'nyse-holidays.json');

function easternDateParts(date) {
  // en-CA gives YYYY-MM-DD ordering, which is easy to split.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const lookup = {};
  for (const part of parts) lookup[part.type] = part.value;
  return {
    isoDate: `${lookup.year}-${lookup.month}-${lookup.day}`,
    weekday: lookup.weekday, // "Mon", "Sat", etc.
  };
}

function loadHolidays() {
  const raw = fs.readFileSync(HOLIDAYS_PATH, 'utf8');
  const json = JSON.parse(raw);
  const all = [];
  for (const key of Object.keys(json)) {
    if (key.startsWith('_')) continue; // skip "_comment"
    if (Array.isArray(json[key])) all.push(...json[key]);
  }
  return new Set(all);
}

function isTradingDay(date = new Date()) {
  const { isoDate, weekday } = easternDateParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return { tradingDay: false, reason: 'weekend', isoDate };
  }
  const holidays = loadHolidays();
  if (holidays.has(isoDate)) {
    return { tradingDay: false, reason: 'holiday', isoDate };
  }
  return { tradingDay: true, reason: null, isoDate };
}

module.exports = { isTradingDay };
