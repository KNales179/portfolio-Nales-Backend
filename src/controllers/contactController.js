import { sendContactMessage } from "../services/emailService.js";

const sendContactMessage = async (req, res) => {
  try {
    const {
      name,
      email,
      subject,
      message,
    } = req.body;

    // Basic validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    await sendContactMessage({
      name,
      email,
      subject,
      message,
    });

    return res.status(200).json({
      success: true,
      message: "Message sent successfully.",
    });
  } catch (error) {
    console.error(
      "Contact email error:",
      error.response?.body || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Failed to send message.",
    });
  }
};

export {
  sendContactMessage,
};