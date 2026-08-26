import { BrevoClient } from "@getbrevo/brevo";

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
});

const sendContactMessage = async ({
  name,
  email,
  subject,
  message,
}) => {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

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

    htmlContent: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>New Portfolio Message</title>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background-color: #f4f4f7;
    font-family: Arial, Helvetica, sans-serif;
    color: #202124;
  "
>

  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="background-color: #f4f4f7; padding: 40px 16px;"
  >

    <tr>
      <td align="center">

        <!-- Main container -->
        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            max-width: 620px;
            background-color: #ffffff;
            border: 1px solid #e5e5ea;
            border-radius: 14px;
            overflow: hidden;
          "
        >

          <!-- Header -->
          <tr>
            <td
              style="
                padding: 28px 32px;
                background-color: #18181b;
              "
            >

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>

                  <td>

                    <div
                      style="
                        font-size: 13px;
                        font-weight: bold;
                        letter-spacing: 2px;
                        color: #a78bfa;
                        margin-bottom: 8px;
                      "
                    >
                      I-BELL
                    </div>

                    <div
                      style="
                        font-size: 24px;
                        font-weight: bold;
                        color: #ffffff;
                      "
                    >
                      New Portfolio Message
                    </div>

                  </td>

                </tr>
              </table>

            </td>
          </tr>


          <!-- Intro -->
          <tr>
            <td style="padding: 32px 32px 20px;">

              <p
                style="
                  margin: 0 0 8px;
                  font-size: 14px;
                  color: #71717a;
                "
              >
                Someone just contacted you through your portfolio.
              </p>

              <h1
                style="
                  margin: 0;
                  font-size: 22px;
                  line-height: 1.4;
                  color: #18181b;
                "
              >
                ${safeSubject}
              </h1>

            </td>
          </tr>


          <!-- Sender information -->
          <tr>
            <td style="padding: 8px 32px 24px;">

              <table
                width="100%"
                cellpadding="0"
                cellspacing="0"
                style="
                  background-color: #fafafa;
                  border: 1px solid #e5e5ea;
                  border-radius: 10px;
                "
              >

                <tr>

                  <td style="padding: 18px 20px;">

                    <div
                      style="
                        font-size: 11px;
                        font-weight: bold;
                        letter-spacing: 1.5px;
                        color: #71717a;
                        margin-bottom: 5px;
                      "
                    >
                      FROM
                    </div>

                    <div
                      style="
                        font-size: 16px;
                        font-weight: bold;
                        color: #18181b;
                        margin-bottom: 4px;
                      "
                    >
                      ${safeName}
                    </div>

                    <div
                      style="
                        font-size: 14px;
                        color: #6366f1;
                      "
                    >
                      ${safeEmail}
                    </div>

                  </td>

                </tr>

              </table>

            </td>
          </tr>


          <!-- Message -->
          <tr>
            <td style="padding: 0 32px 28px;">

              <div
                style="
                  font-size: 11px;
                  font-weight: bold;
                  letter-spacing: 1.5px;
                  color: #71717a;
                  margin-bottom: 10px;
                "
              >
                MESSAGE
              </div>

              <div
                style="
                  padding: 20px;
                  background-color: #fafafa;
                  border-left: 3px solid #8b5cf6;
                  border-radius: 6px;
                  font-size: 15px;
                  line-height: 1.7;
                  color: #3f3f46;
                  word-break: break-word;
                "
              >
                ${safeMessage}
              </div>

            </td>
          </tr>


          <!-- Reply button -->
          <tr>
            <td
              align="center"
              style="padding: 0 32px 32px;"
            >

              <a
                href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Re: ${subject}`)}"
                style="
                  display: inline-block;
                  padding: 13px 24px;
                  background-color: #7c3aed;
                  color: #ffffff;
                  text-decoration: none;
                  font-size: 14px;
                  font-weight: bold;
                  border-radius: 8px;
                "
              >
                Reply to ${safeName}
              </a>

            </td>
          </tr>


          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">

              <div
                style="
                  height: 1px;
                  background-color: #e5e5ea;
                "
              ></div>

            </td>
          </tr>


          <!-- Footer -->
          <tr>
            <td
              style="
                padding: 22px 32px 28px;
                text-align: center;
              "
            >

              <p
                style="
                  margin: 0;
                  font-size: 12px;
                  color: #a1a1aa;
                  line-height: 1.6;
                "
              >
                This message was sent through the contact form on
                <strong style="color: #71717a;">
                  Ivhel Nales' portfolio
                </strong>.
              </p>

              <p
                style="
                  margin: 8px 0 0;
                  font-size: 11px;
                  color: #a1a1aa;
                "
              >
                I-Bell · Full-stack Developer
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>

  </table>

</body>
</html>
`,

    // Plain-text fallback
    textContent: `
NEW PORTFOLIO MESSAGE
=====================

${subject}

FROM
${name}
${email}

MESSAGE
-------
${message}

Reply directly to this email to respond to ${name}.

--
Ivhel Nales
I-Bell · Full-stack Developer
    `,
  });
};


// Escape user-provided content before inserting it into HTML
const escapeHtml = (value = "") => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};


export {
  sendContactMessage,
};