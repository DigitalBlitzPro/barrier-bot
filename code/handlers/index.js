// job type -> handler. Bots are added here one at a time as they are built.
const { territoryScan } = require('./territoryScan');
const { cityConflictCheck } = require('./cityConflict');

module.exports = {
  territory_scan: territoryScan,
  city_conflict_check: cityConflictCheck,
};
