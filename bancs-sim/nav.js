// Left navigation, data-driven by product and by whether an endorsement is open. Order is read
// off the 4 August 2026 recording. `route` names a built screen; anything else renders the
// generic placeholder section.
const ITEMS = {
  'contracting-party': 'Contracting Party',
  'business-entity': 'Business Entity',
  'replacement-con-pty': 'Replacement Con Pty',
  'contribution-payer-info': 'Contribution Payer Info',
  'contribution-detail': 'Contribution Detail',
  'repay-contribution': 'Repay Contribution',
  'fund-allocation': 'Fund Allocation',
  'fund-property': 'Fund Property',
  'policy-summary': 'Policy Summary',
  'basic-details': 'Basic Details',
  'payment-cycle': 'Payment Cycle',
  'beneficiary': 'Beneficiary',
  'premium-payer-info': 'Premium Payer Info',
  'once-off-payer-info': 'Once Off Payer Info',
  'aml-details': 'AML Details',
  'underwriting-details': 'Underwriting Details',
  'endr-quote-summary': 'Endr Quote Summary',
  'policy-action-details': 'Policy Action Details',
  'endr-quote-submission': 'Endr Quote Submission',
  'acceptance': 'Acceptance',
  'requestor-advisor-info': 'Requestor Advisor Info',
  'adviser-info': 'Adviser Info',
  'advisor-change': 'Advisor Change',
  'layer-info': 'Layer Info',
  'endorsement-quotes': 'Endorsement Quotes',
  'cessionary': 'Cessionary',
  'follow-up': 'Follow Up',
  'notes': 'Notes',
  'document': 'Document'
};

const ROUTES = {
  'basic-details': id => `/policy/${id}/basic-details`,
  'policy-action-details': id => `/policy/${id}`,
  'acceptance': id => `/policy/${id}/acceptance`,
  'advisor-change': id => `/policy/${id}/advisor-change`,
  'endr-quote-summary': id => `/policy/${id}/quote-summary`,
  'endr-quote-submission': id => `/policy/${id}/quote-submission`,
  'endorsement-quotes': id => `/policy/${id}/endorsement-quotes`,
  'requestor-advisor-info': id => `/policy/${id}/requestor-advisor-info`
};

const LISTS = {
  OMSLISPI: {
    policy: ['contracting-party', 'replacement-con-pty', 'contribution-payer-info', 'contribution-detail',
      'repay-contribution', 'fund-allocation', 'fund-property', 'policy-summary', 'basic-details', 'payment-cycle',
      'beneficiary', 'aml-details', 'underwriting-details', 'policy-action-details', 'acceptance',
      'requestor-advisor-info', 'adviser-info', 'layer-info', 'endorsement-quotes', 'cessionary'],
    endorsement: ['contracting-party', 'replacement-con-pty', 'contribution-payer-info', 'contribution-detail',
      'repay-contribution', 'fund-allocation', 'fund-property', 'basic-details', 'payment-cycle', 'beneficiary',
      'aml-details', 'underwriting-details', 'endr-quote-summary', 'policy-action-details', 'endr-quote-submission',
      'acceptance', 'requestor-advisor-info', 'adviser-info', 'advisor-change', 'layer-info']
  },
  OMSTFII: {
    policy: ['contracting-party', 'business-entity', 'replacement-con-pty', 'basic-details', 'beneficiary',
      'premium-payer-info', 'once-off-payer-info', 'adviser-info', 'payment-cycle', 'aml-details',
      'underwriting-details', 'policy-summary', 'policy-action-details', 'acceptance', 'requestor-advisor-info',
      'follow-up', 'notes', 'document', 'endorsement-quotes', 'layer-info'],
    endorsement: ['contracting-party', 'business-entity', 'replacement-con-pty', 'basic-details', 'beneficiary',
      'premium-payer-info', 'once-off-payer-info', 'adviser-info', 'payment-cycle', 'aml-details',
      'underwriting-details', 'endr-quote-summary', 'policy-action-details', 'endr-quote-submission', 'acceptance',
      'requestor-advisor-info', 'advisor-change', 'layer-info', 'follow-up', 'notes', 'document']
  }
};

// The transition-list products (OMP Life in the open book, GL Death / GL Final Expenses in the closed book)
// carry the risk-product menu, the same as TFI II's in the recording.
for (const code of ['OMPLIFE', 'OMPFLIFE', 'GLDEATH', 'GLFINEXP']) LISTS[code] = LISTS.OMSTFII;

// Which sections an endorsement type works on. BaNCS greys these items in the left menu once the
// endorsement is open (SOP screenshots: for Change Advisor Details, Basic Details, Adviser Info and
// Advisor Change are grey; every other item is plain).
const SECTIONS_BY_TYPE = {
  'Change Advisor Details': ['basic-details', 'adviser-info', 'advisor-change'],
  'Change Primary IMED': ['requestor-advisor-info', 'adviser-info'],
  'Add Beneficiary': ['beneficiary'],
  'Change Payment Method': ['payment-cycle'],
  'Update Contracting Party Details': ['contracting-party']
};
// Items that only exist while an endorsement of a given type is open.
const ONLY_FOR_TYPE = { 'advisor-change': 'Change Advisor Details' };

// The left menu appears on every policy screen (policy view, open endorsement, and the dialogs over
// them); it is not on login, the home page, search or the work lists. `endorsement` is the open
// endorsement, or null on the policy view.
function leftNav(productCode, contractNo, endorsement, active) {
  const list = (LISTS[productCode] || LISTS.OMSLISPI)[endorsement ? 'endorsement' : 'policy'];
  const types = endorsement ? endorsement.types || [] : [];
  const scoped = new Set(types.flatMap(t => SECTIONS_BY_TYPE[t] || []));
  return list
    .filter(slug => !ONLY_FOR_TYPE[slug] || types.includes(ONLY_FOR_TYPE[slug]))
    .map(slug => ({
      slug,
      id: `nav-${slug}`,
      label: ITEMS[slug],
      href: ROUTES[slug] ? ROUTES[slug](contractNo) : `/policy/${contractNo}/section/${slug}`,
      active: slug === active,
      scoped: scoped.has(slug)
    }));
}

// Top navigation by role. The verifier profile in the recording only had Policy Servicing.
const TOP = {
  'SYS-ADMIN': [
    ['work-items', 'Work Items'], ['business-partners', 'Business Partners'],
    ['maintain-intermediary', 'Maintain Intermediary'], ['new-business', 'New Business'],
    ['policy-servicing', 'Policy Servicing'], ['claims', 'Claims'], ['document-fax', 'Document & Fax']
  ],
  'PREM-ADM': [['policy-servicing', 'Policy Servicing']]
};

function topNav(role, active) {
  return (TOP[role] || TOP['SYS-ADMIN']).map(([slug, label]) => ({
    slug, label, id: `topnav-${slug}`,
    href: slug === 'policy-servicing' ? '/policy-servicing/search' : `/module/${slug}`,
    active: slug === active
  }));
}

module.exports = { ITEMS, leftNav, topNav };
