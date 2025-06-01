const amqp = require("amqplib");
const nodemailer = require("nodemailer");
const logger = require("./utils/logger");
require("dotenv").config();

let channel;
let transporter;

// Setup email transporter
const setupMailTransport = () => {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "mailpit",
    port: process.env.SMTP_PORT || 1025,
    secure: false,
    tls: {
      rejectUnauthorized: false,
    },
  });
  logger.info("Email transport configured");
};

// Setup RabbitMQ connection and channel
const setupRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672"
    );
    channel = await connection.createChannel();

    // Declare exchange
    await channel.assertExchange("booking_exchange", "direct", { durable: true });

    // Declare queue
    await channel.assertQueue("notification_q", { durable: true });

    // Bind queue to exchange with different routing keys
    const routingKeys = [
      "notification.pending",
      "notification.success",
      "notification.failed",
      "notification.expired",
    ];

    for (const key of routingKeys) {
      await channel.bindQueue("notification_q", "booking_exchange", key);
      logger.info(`Bound queue to exchange with routing key: ${key}`);
    }

    // Start consuming messages
    await channel.consume("notification_q", handleNotification, { noAck: true });

    logger.info("RabbitMQ setup completed");
  } catch (error) {
    logger.error("Error setting up RabbitMQ:", error);
    process.exit(1);
  }
};

// Handle notification message
const handleNotification = async (msg) => {
  try {
    const data = JSON.parse(msg.content.toString());
    const { type, email_to, booking_id, details } = data;

    logger.info(`Processing ${type} notification for booking ${booking_id}`);

    // Prepare email content based on notification type
    const emailContent = prepareEmailContent(type, booking_id, details);

    // Send email
    await sendEmail(email_to, emailContent.subject, emailContent.text);
    logger.info(`Notification sent: ${type} to ${email_to} for booking ${booking_id}`);
  } catch (error) {
    logger.error("Error handling notification:", error);
  }
};

// Prepare email content based on notification type
const prepareEmailContent = (type, booking_id, details) => {
  let subject = "";
  let text = "";

  switch (type) {
    case "BOOKING_PENDING_PAYMENT":
      subject = `Flight Booking Payment Required - Booking ${booking_id}`;
      text = `Your flight booking (${booking_id}) is pending payment.\n\n${details}\n\nPlease complete your payment to confirm your booking.`;
      break;

    case "BOOKING_CONFIRMED":
      subject = `Flight Booking Confirmed - Booking ${booking_id}`;
      text = `Your flight booking (${booking_id}) has been confirmed.\n\n${details}\n\nThank you for choosing our service!`;
      break;

    case "BOOKING_PAYMENT_FAILED":
      subject = `Flight Booking Payment Failed - Booking ${booking_id}`;
      text = `Your payment for flight booking (${booking_id}) has failed.\n\n${details}\n\nPlease try again or contact support for assistance.`;
      break;

    case "BOOKING_EXPIRED":
      subject = `Flight Booking Expired - Booking ${booking_id}`;
      text = `Your flight booking (${booking_id}) has expired.\n\n${details}\n\nPlease make a new booking if you still wish to travel.`;
      break;

    default:
      subject = `Flight Booking Update - Booking ${booking_id}`;
      text = `Update regarding your flight booking (${booking_id}):\n\n${details}`;
  }

  logger.debug(`Prepared email content for ${type}`, { booking_id, subject });
  return { subject, text };
};

// Send email using nodemailer
const sendEmail = async (to, subject, text) => {
  try {
    logger.info(`Sending email to ${to}`, { subject });
    await transporter.sendMail({
      from: "noreply@flightbooking.com",
      to,
      subject,
      text,
    });
    logger.info(`Email sent successfully to ${to}`);
  } catch (error) {
    logger.error("Error sending email:", error);
  }
};

// Start the service
const startService = async () => {
  setupMailTransport();
  await setupRabbitMQ();
  logger.info("Notification Service is running...");
};

// Handle cleanup
const cleanup = async () => {
  if (channel) {
    try {
      await channel.close();
      logger.info("RabbitMQ channel closed");
    } catch (error) {
      logger.error("Error closing RabbitMQ channel:", error);
    }
  }
  logger.info("Service shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// Start the service
startService();
