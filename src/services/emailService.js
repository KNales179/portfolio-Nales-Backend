const brevo = require("@getbrevo/brevo");

const apiInstance = new brevo.TransactionalEmailsApi();

apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

const sendContactEmail = async ({
  name,
  email,
  subject,
  message,
}) => {
  const sendSmtpEmail = new brevo.SendSmtpEmail();

  sendSmtpEmail.subject = `Portfolio Contact: ${subject}`;

  sendSmtpEmail.sender = {
    email: process.env.BREVO_SENDER_EMAIL,
    name: process.env.BREVO_SENDER_NAME,
  };

  // YOUR email
  sendSmtpEmail.to = [
    {
      email: process.env.CONTACT_EMAIL,
    },
  ];

  // CLIENT'S email
  sendSmtpEmail.replyTo = {
    email,
    name,
  };

  sendSmtpEmail.textContent = `
You received a new message through your portfolio.

Name: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}
`;

  return await apiInstance.sendTransacEmail(sendSmtpEmail);
};

module.exports = {
  sendContactEmail,
};