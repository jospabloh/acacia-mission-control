// Dynamic control router — ONE Vercel serverless function for every
// `/api/control/<action>` endpoint. Vercel counts each file under api/ as a
// function and the Hobby plan caps us at 12; collapsing the seven control
// handlers into this single dynamic route frees the budget for new endpoints
// (e.g. the `members` action that powers F8 Ajustes). The handler bodies live
// under api/_lib/control/ (underscore-prefixed → never their own functions) and
// are dispatched here by the `[action]` path segment, so the client paths
// (/api/control/run-sync, /api/control/license-action, …) are unchanged.
import runSync from '../_lib/control/run-sync.js'
import licenseAction from '../_lib/control/license-action.js'
import tickets from '../_lib/control/tickets.js'
import sendMessage from '../_lib/control/send-message.js'
import listContacts from '../_lib/control/list-contacts.js'
import usageByTenant from '../_lib/control/usage-by-tenant.js'
import emailStatus from '../_lib/control/email-status.js'
import members from '../_lib/control/members.js'
import sessions from '../_lib/control/sessions.js'
import sessionRevoke from '../_lib/control/session-revoke.js'
import licenseDeletePremiumData from '../_lib/control/license-delete-premium-data.js'
import licenseRecord from '../_lib/control/license-record.js'
import paymentReport from '../_lib/control/payment-report.js'
import paymentConfirm from '../_lib/control/payment-confirm.js'
import testimonialReview from '../_lib/control/testimonial-review.js'

const ROUTES = {
  'run-sync': runSync,
  'license-action': licenseAction,
  'tickets': tickets,
  'send-message': sendMessage,
  'list-contacts': listContacts,
  'usage-by-tenant': usageByTenant,
  'email-status': emailStatus,
  'members': members,
  'sessions': sessions,
  'session-revoke': sessionRevoke,
  'license-delete-premium-data': licenseDeletePremiumData,
  'license-record': licenseRecord,
  'payment-report': paymentReport,
  'payment-confirm': paymentConfirm,
  'testimonial-review': testimonialReview,
}

export default async function handler(req, res) {
  // Vercel fills req.query.action from the [action] path segment.
  const action = req.query?.action
  const fn = ROUTES[action]
  if (!fn) return res.status(404).json({ error: `acción de control desconocida: ${action ?? '∅'}` })
  return fn(req, res)
}
