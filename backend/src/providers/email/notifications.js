const templates = {
  merchant_application_received: ({ name, businessName }) => ({
    subject: 'We received your merchant application',
    text: `Hello ${name},\n\nWe received the merchant account application for ${businessName}. An administrator will review it. Booking access remains disabled until approval.`
  }),
  merchant_application_approved: ({ name, businessName }) => ({
    subject: 'Your merchant account is approved',
    text: `Hello ${name},\n\nThe merchant account for ${businessName} is approved. You can sign in and create parcel bookings.`
  }),
  merchant_application_rejected: ({ name, businessName }) => ({
    subject: 'Update on your merchant application',
    text: `Hello ${name},\n\nThe merchant account application for ${businessName} was not approved. Contact the courier office if you need more information.`
  }),
  merchant_application_suspended: ({ name, businessName }) => ({
    subject: 'Your merchant account is suspended',
    text: `Hello ${name},\n\nThe merchant account for ${businessName} has been suspended. Contact the courier office if you need more information.`
  })
};

const renderNotification = (template, payload) => {
  const render = templates[template];
  if (!render) throw new Error(`Unsupported email notification template: ${template}`);
  return render(payload || {});
};

module.exports = { renderNotification };
