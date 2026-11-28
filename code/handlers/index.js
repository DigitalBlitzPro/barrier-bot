// job type -> handler. Bots are added here one at a time as they are built.
const { territoryScan } = require('./territoryScan');
const { cityConflictCheck } = require('./cityConflict');
const { setTerm, resume, offboard } = require('./lifecycle');
const { baselineAudit, monthlySnapshot } = require('./measureJobs');

module.exports = {
  territory_scan: territoryScan,
  city_conflict_check: cityConflictCheck,
  set_term: setTerm,
  resume,
  offboard,
  baseline_audit: baselineAudit,
  monthly_snapshot: monthlySnapshot,
};
