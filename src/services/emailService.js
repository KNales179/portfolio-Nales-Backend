import { BrevoClient } from "@getbrevo/brevo";

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
});

const sendContactEmail = async ({
  name,
  email,
  subject,
  message,
}) => {
  return await brevo.transactionalEmails.sendTransacEmail({
    subject: `Portfolio Contact: ${subject}`,

    sender: {
      email: process.env.BREVO_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME,
    },

    to: [
      {
        email: process.env.CONTACT_EMAIL,
      },
    ],

    replyTo: {
      email,
      name,
    },

    textContent: `
You received a new message through your portfolio.

Name: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}
`,
  });
};

export {
  sendContactEmail,
};