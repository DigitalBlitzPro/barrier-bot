// job type -> handler. Bots are added here one at a time as they are built.
const { territoryScan } = require('./territoryScan');

module.exports = {
  territory_scan: territoryScan,
};
