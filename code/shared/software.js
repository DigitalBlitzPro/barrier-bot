// Reads finished jobs from a client's job software, so review asks go out after each visit.
// Each connector: test() -> true or throws; finishedJobs(sinceDate) -> [{ jobId, firstName, lastName, phone, email, tech, commercial, at }].
// FieldRoutes and GorillaDesk are built. Jobber uses its own review link (status "Jobber Link"). The rest are not supported yet.
// Field names follow each vendor's public docs; verify against a live account before relying on them (STATUS.md).

const json = async (res, what) => {
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) throw new Error(`${what}: the API key was refused (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 150)}`);
  return j;
};
const vals = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function fieldRoutes({ subdomain, key, token }, fetchImpl = fetch) {
  if (!subdomain) throw new Error('FieldRoutes needs the company subdomain (the part before .fieldroutes.com)');
  const base = `https://${String(subdomain).replace(/\.fieldroutes\.com.*$/i, '').replace(/^https?:\/\//, '')}.fieldroutes.com/api`;
  const post = async (path, params) => json(await fetchImpl(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ authenticationKey: key, authenticationToken: token, ...params }).toString(),
    signal: AbortSignal.timeout(30000),
  }), `FieldRoutes ${path}`);
  return {
    async test() {
      const r = await post('employee/search', { active: '1' });
      if (r.success === false) throw new Error(`FieldRoutes: ${r.errorMessage || 'login refused'}`);
      return true;
    },
    async finishedJobs(since) {
      const r = await post('appointment/search', { status: '1', includeData: '1', dateCompleted: JSON.stringify({ operator: '>=', value: ymd(since) }) });
      const appts = vals(r.appointments).filter((a) => String(a.status) === '1');
      if (!appts.length) return [];
      const ids = (k) => [...new Set(appts.map((a) => a[k]).filter(Boolean))];
      const customers = Object.fromEntries(vals((await post('customer/get', { customerIDs: JSON.stringify(ids('customerID')) })).customers).map((c) => [String(c.customerID), c]));
      const empIds = ids('servicedBy').length ? ids('servicedBy') : ids('employeeID');
      const emps = empIds.length ? Object.fromEntries(vals((await post('employee/get', { employeeIDs: JSON.stringify(empIds) })).employees).map((e) => [String(e.employeeID), e])) : {};
      return appts.map((a) => {
        const c = customers[String(a.customerID)] || {};
        const e = emps[String(a.servicedBy || a.employeeID)] || {};
        return {
          jobId: `fr:${a.appointmentID}`, firstName: c.fname || '', lastName: c.lname || '', phone: c.phone1 || c.phone2 || '', email: c.email || '',
          tech: [e.fname, e.lname].filter(Boolean).join(' '), commercial: String(c.commercialAccount) === '1', at: a.dateCompleted || a.date,
        };
      });
    },
  };
}

function gorillaDesk({ key }, fetchImpl = fetch) {
  const get = async (path) => json(await fetchImpl(`https://api.gorilladesk.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
  }), 'GorillaDesk');
  return {
    async test() { await get('jobs?limit=1'); return true; },
    async finishedJobs(since) {
      const out = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const r = await get(`jobs?date%5Bgte%5D=${encodeURIComponent(new Date(since).toISOString())}&include=customer,schedules&limit=100&offset=${offset}`);
        for (const j of r.data || []) {
          const done = j.check_out_time || /complete|done|finished/i.test(j.status?.label || '');
          if (!done) continue;
          const c = j.customer || {};
          const phone = c.phone || c.mobile || (Array.isArray(c.phones) && (c.phones[0]?.number || c.phones[0])) || '';
          const email = c.email || (Array.isArray(c.emails) && (c.emails[0]?.email || c.emails[0])) || '';
          const tech = (j.schedules || []).map((s) => s.user?.name || [s.user?.first_name, s.user?.last_name].filter(Boolean).join(' ') || s.name).find(Boolean) || '';
          out.push({
            jobId: `gd:${j.id}`, firstName: c.first_name || c.firstName || String(c.name || '').split(' ')[0] || '', lastName: c.last_name || c.lastName || String(c.name || '').split(' ').slice(1).join(' '),
            phone: String(phone || ''), email: String(email || ''), tech, commercial: /commercial/i.test(c.type || c.customer_type || ''), at: j.check_out_time || j.date,
          });
        }
        if (!r.has_more) break;
      }
      return out;
    },
  };
}

// conn: { software, secret: { key, token, subdomain } }
function connectorFor(software, secret, fetchImpl) {
  const s = String(software || '').toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('fieldroutes') || s.includes('pestroutes')) return { kind: 'fieldroutes', api: fieldRoutes(secret, fetchImpl) };
  if (s.includes('gorilla')) return { kind: 'gorilladesk', api: gorillaDesk(secret, fetchImpl) };
  if (s.includes('jobber')) return { kind: 'jobber', api: null };
  return { kind: 'unsupported', api: null };
}

module.exports = { connectorFor, fieldRoutes, gorillaDesk };
