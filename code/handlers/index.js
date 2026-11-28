// job type -> handler. Bots are added here one at a time as they are built.
const { territoryScan } = require('./territoryScan');
const { cityConflictCheck } = require('./cityConflict');
const { setTerm, resume, offboard } = require('./lifecycle');
const { baselineAudit, monthlySnapshot } = require('./measureJobs');
const { monthlyReport } = require('./monthlyReport');
const { monthlyWork } = require('./monthlyWork');
const jobs = require('./clientJobs');

module.exports = {
  territory_scan: territoryScan,
  city_conflict_check: cityConflictCheck,
  set_term: setTerm,
  resume,
  offboard,
  baseline_audit: baselineAudit,
  monthly_snapshot: monthlySnapshot,
  monthly_report: monthlyReport,
  monthly_work: monthlyWork,
  start_month1: jobs.startMonth1,
  access_check: jobs.accessCheck,
  create_subaccount: jobs.createSubaccount,
  software_test: jobs.softwareTest,
  software_sync: jobs.softwareSync,
  review_done: jobs.reviewDone,
  review_do_not_ask: jobs.reviewDoNotAsk,
  review_approval: jobs.reviewApproval,
  photo_intake: jobs.photoIntake,
  referral: jobs.referral,
};
