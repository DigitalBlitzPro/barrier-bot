const test = require('node:test');
const assert = require('node:assert');
const { parseGhlWebhook } = require('../code/shared/ghlPayload');

test('maps standard and Barrier fields, lists and yes/no', () => {
  const p = parseGhlWebhook({
    contact_id: 'abc', full_name: 'Pat Owner', company_name: 'Bug Busters', phone: '+16165550100',
    'Barrier - Registered City': 'Grand Rapids', 'Barrier - Service Cities': 'Wyoming\nKentwood\n',
    'Barrier - Services Offered': ['General Pest Control (recurring plan)', 'Rodent Control'],
    'Barrier - Has Business Phone System': 'No', 'Barrier - EIN': '12-3456789',
    location: { id: 'LOC1' }, customData: { 'Barrier - GBP URL': 'https://maps.app.goo.gl/x' },
  });
  assert.equal(p.contactId, 'abc');
  assert.equal(p.locationId, 'LOC1');
  assert.equal(p.fields.company, 'Bug Busters');
  assert.deepEqual(p.fields.service_cities, ['Wyoming', 'Kentwood']);
  assert.deepEqual(p.fields.services_offered, ['General Pest Control (recurring plan)', 'Rodent Control']);
  assert.equal(p.fields.has_phone_system, false);
  assert.equal(p.fields.ein, '123456789');
  assert.equal(p.fields.gbp_url, 'https://maps.app.goo.gl/x');
});

test('drops blanks and a malformed EIN', () => {
  const p = parseGhlWebhook({ contact_id: 'x', company_name: '', 'Barrier - EIN': '1234' });
  assert.equal(p.fields.company, undefined);
  assert.equal(p.fields.ein, undefined);
});
