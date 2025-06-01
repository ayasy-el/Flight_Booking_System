const amqp = require("amqplib");
const readline = require("readline");
const logger = require("./utils/logger");
require("dotenv").config();

let channel;

// Setup RabbitMQ connection and channel
const setupRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672"
    );
    channel = await connection.createChannel();

    // Declare exchange
    await channel.assertExchange("booking_exchange", "direct", { durable: true });

    // Declare queues
    await channel.assertQueue("payment_request_q", { durable: true });

    // Bind queue to exchange
    await channel.bindQueue("payment_request_q", "booking_exchange", "payment.request");

    logger.info("RabbitMQ setup completed");
  } catch (error) {
    logger.error("Error setting up RabbitMQ:", error);
    process.exit(1);
  }
};

// Setup readline interface for manual input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Process payment request
const processPayment = async (msg) => {
  try {
    const data = JSON.parse(msg.content.toString());
    const { booking_id, amount, payment_due_timestamp } = data;

    // Check if payment window has expired
    if (new Date() >= new Date(payment_due_timestamp)) {
      logger.warn(`Payment window expired for booking ${booking_id}`);
      await sendPaymentStatus(booking_id, "FAILED", "PAYMENT_WINDOW_EXPIRED");
      return;
    }

    logger.info("\nNew payment request received:", {
      booking_id,
      amount,
      payment_due_timestamp,
    });

    // Ask for manual input to simulate payment success/failure
    rl.question("\nSimulate payment result (s for success, f for failure): ", async (answer) => {
      if (answer.toLowerCase() === "s") {
        await sendPaymentStatus(booking_id, "SUCCESS");
        logger.info(`Payment successful for booking ${booking_id}`);
      } else {
        await sendPaymentStatus(booking_id, "FAILED", "Payment declined");
        logger.info(`Payment failed for booking ${booking_id}`);
      }
      logger.info("Waiting for next payment request...");
    });
  } catch (error) {
    logger.error("Error processing payment:", error);
  }
};

// Send payment status back to booking service
const sendPaymentStatus = async (booking_id, status, reason = "") => {
  try {
    logger.info(`Sending payment status for booking ${booking_id}: ${status}`);
    await channel.publish(
      "booking_exchange",
      "payment.status",
      Buffer.from(
        JSON.stringify({
          booking_id,
          payment_status: status,
          reason,
          payment_timestamp: new Date().toISOString(),
        })
      )
    );
    logger.info(`Payment status sent successfully for booking ${booking_id}`);
  } catch (error) {
    logger.error("Error sending payment status:", error);
  }
};

// Start the service
const startService = async () => {
  await setupRabbitMQ();

  // Start consuming payment requests
  await channel.consume("payment_request_q", processPayment, { noAck: true });
  logger.info("Payment Service is running. Waiting for payment requests...");
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
  rl.close();
  logger.info("Service shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// Start the service
startService();
