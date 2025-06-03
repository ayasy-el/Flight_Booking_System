const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const amqp = require("amqplib");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const logger = require("./utils/logger");
require("dotenv").config();

const prisma = new PrismaClient();

// Load proto file
const PROTO_PATH = path.resolve(__dirname, "../proto/booking.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const bookingProto = grpc.loadPackageDefinition(packageDefinition).booking;

// RabbitMQ setup
let channel;
const setupRabbitMQ = async () => {
  let retries = 0;
  const maxRetries = 5;
  const retryInterval = 5000; // 5 seconds

  while (retries < maxRetries) {
    try {
      const connection = await amqp.connect(
        process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672"
      );
      channel = await connection.createChannel();

      // Declare exchanges
      await channel.assertExchange("booking_exchange", "direct", { durable: true });
      await channel.assertExchange("booking_expiry_exchange", "x-delayed-message", {
        durable: true,
        arguments: { "x-delayed-type": "direct" },
      });

      // Declare queues
      await channel.assertQueue("payment_request_q", { durable: true });
      await channel.assertQueue("payment_status_q", { durable: true });
      await channel.assertQueue("notification_q", { durable: true });
      await channel.assertQueue("expired_booking_q", { durable: true });

      // Bind queues to exchanges
      await channel.bindQueue("payment_request_q", "booking_exchange", "payment.request");
      await channel.bindQueue("payment_status_q", "booking_exchange", "payment.status");
      await channel.bindQueue("notification_q", "booking_exchange", "notification.pending");
      await channel.bindQueue("notification_q", "booking_exchange", "notification.success");
      await channel.bindQueue("notification_q", "booking_exchange", "notification.failed");
      await channel.bindQueue("notification_q", "booking_exchange", "notification.expired");
      await channel.bindQueue("expired_booking_q", "booking_expiry_exchange", "booking.expired");

      // Setup consumers
      await channel.consume("payment_status_q", handlePaymentStatus, { noAck: true });
      await channel.consume("expired_booking_q", handleExpiredBooking, { noAck: true });

      logger.info("RabbitMQ setup completed successfully");
      break;
    } catch (error) {
      retries++;
      logger.warn(`Failed to setup RabbitMQ (attempt ${retries}/${maxRetries}):`, error.message);

      if (retries === maxRetries) {
        logger.error("Max retries reached. Failed to setup RabbitMQ:", error);
        process.exit(1);
      }

      logger.info(`Retrying in ${retryInterval / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
  }
};

// Handle payment status updates
const handlePaymentStatus = async (msg) => {
  try {
    const data = JSON.parse(msg.content.toString());
    logger.info(
      `Received payment status update for booking ${data.booking_id}: ${data.payment_status}`
    );

    const booking = await prisma.booking.findUnique({
      where: { id: data.booking_id },
      include: { flight: true },
    });

    if (!booking) {
      logger.error(`Booking not found: ${data.booking_id}`);
      return;
    }

    if (data.payment_status === "SUCCESS") {
      logger.info(`Processing successful payment for booking ${data.booking_id}`);
      // Update booking status to confirmed
      await prisma.booking.update({
        where: { id: data.booking_id },
        data: { status: "CONFIRMED" },
      });

      // Send confirmation notification
      await channel.publish(
        "booking_exchange",
        "notification.success",
        Buffer.from(
          JSON.stringify({
            type: "BOOKING_CONFIRMED",
            email_to: booking.user_email,
            booking_id: booking.id,
            details: "Your booking has been confirmed.",
          })
        )
      );
      logger.info(`Sent confirmation notification for booking ${data.booking_id}`);
    } else {
      logger.info(`Processing failed payment for booking ${data.booking_id}`);
      // Update booking status to failed and restore seats
      await prisma.$transaction([
        prisma.booking.update({
          where: { id: data.booking_id },
          data: { status: "FAILED_PAYMENT" },
        }),
        prisma.flight.update({
          where: { id: booking.flight_id },
          data: {
            available_seats: {
              increment: booking.num_seats,
            },
          },
        }),
      ]);

      // Send failure notification
      await channel.publish(
        "booking_exchange",
        "notification.failed",
        Buffer.from(
          JSON.stringify({
            type: "BOOKING_PAYMENT_FAILED",
            email_to: booking.user_email,
            booking_id: booking.id,
            details: `Payment failed: ${data.reason}`,
          })
        )
      );
      logger.info(`Sent failure notification for booking ${data.booking_id}`);
    }
  } catch (error) {
    logger.error("Error handling payment status:", error);
  }
};

// Handle expired bookings
const handleExpiredBooking = async (msg) => {
  try {
    const data = JSON.parse(msg.content.toString());
    const { booking_id } = data;
    logger.info(`Processing expired booking: ${booking_id}`);

    // Use transaction to update booking status and restore seats
    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: booking_id },
        include: { flight: true },
      });

      if (!booking || booking.status !== "PENDING_PAYMENT") {
        return;
      }

      // Update booking status to EXPIRED
      await tx.booking.update({
        where: { id: booking_id },
        data: { status: "EXPIRED" },
      });

      // Restore seats
      await tx.flight.update({
        where: { id: booking.flight_id },
        data: {
          available_seats: {
            increment: booking.num_seats,
          },
        },
      });

      // Send expired notification
      await channel.publish(
        "booking_exchange",
        "notification.expired",
        Buffer.from(
          JSON.stringify({
            type: "BOOKING_EXPIRED",
            email_to: booking.user_email,
            booking_id: booking.id,
            details: "Booking expired due to no payment.",
          })
        )
      );

      logger.info(`Booking ${booking_id} marked as expired and seats restored`);
    });
  } catch (error) {
    logger.error("Error handling expired booking:", error);
  }
};

// Helper function to create gRPC error
const createGrpcError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// gRPC service implementation
const server = new grpc.Server();

server.addService(bookingProto.BookingService.service, {
  // Search Flights
  SearchFlights: async (call, callback) => {
    try {
      const { origin, destination, date, limit = 10, page = 1 } = call.request;
      logger.info(
        `Searching flights - Origin: ${origin}, Destination: ${destination}, Date: ${date}`
      );

      const skip = (page - 1) * limit;

      // Build where clause
      const where = {};
      if (origin) where.origin = { equals: origin, mode: "insensitive" };
      if (destination) where.destination = { equals: destination, mode: "insensitive" };
      if (date) {
        const searchDate = new Date(date);
        if (isNaN(searchDate.getTime())) {
          return callback(createGrpcError(grpc.status.INVALID_ARGUMENT, "Invalid date format"));
        }
        where.departure_time = {
          gte: searchDate,
          lt: new Date(searchDate.getTime() + 24 * 60 * 60 * 1000),
        };
      }

      // Get flights with pagination
      const [flights, total] = await prisma.$transaction([
        prisma.flight.findMany({
          where,
          select: {
            id: true,
            airline: true,
            origin: true,
            destination: true,
            departure_time: true,
            arrival_time: true,
            price_per_seat: true,
            total_seats: true,
            available_seats: true,
          },
          skip,
          take: limit,
          orderBy: { departure_time: "asc" },
        }),
        prisma.flight.count({ where }),
      ]);

      // Format the response
      const formattedFlights = flights.map((flight) => ({
        ...flight,
        price_per_seat: parseFloat(flight.price_per_seat.toString()),
        departure_time:
          flight.departure_time instanceof Date
            ? flight.departure_time.toISOString()
            : flight.departure_time,
        arrival_time:
          flight.arrival_time instanceof Date
            ? flight.arrival_time.toISOString()
            : flight.arrival_time,
      }));

      const total_pages = Math.ceil(total / limit);
      logger.info(`Found ${flights.length} flights (total: ${total})`);

      callback(null, {
        flights: formattedFlights,
        total,
        page,
        limit,
        total_pages,
      });
    } catch (error) {
      logger.error("Error searching flights:", error);
      callback(createGrpcError(grpc.status.INTERNAL, "Error searching flights"));
    }
  },

  // Create Booking
  CreateBooking: async (call, callback) => {
    try {
      const { flight_id, user_email, num_seats } = call.request;
      logger.info(`Creating booking for flight ${flight_id} - ${num_seats} seats`);

      const result = await prisma.$transaction(async (tx) => {
        // Get flight and check availability
        const flight = await tx.flight.findUnique({
          where: { id: flight_id },
        });

        if (!flight) {
          throw createGrpcError(grpc.status.NOT_FOUND, `Flight with ID ${flight_id} not found`);
        }

        if (flight.available_seats < num_seats) {
          throw createGrpcError(
            grpc.status.FAILED_PRECONDITION,
            `Not enough seats available. Requested: ${num_seats}, Available: ${flight.available_seats}`
          );
        }

        // Calculate booking details
        const payment_due_timestamp = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        const total_price = flight.price_per_seat * num_seats;

        // Create booking and update flight seats
        const booking = await tx.booking.create({
          data: {
            flight_id,
            user_email,
            num_seats,
            total_price,
            payment_due_timestamp,
          },
        });

        // Update available seats
        await tx.flight.update({
          where: { id: flight_id },
          data: {
            available_seats: {
              decrement: num_seats,
            },
          },
        });

        // Schedule expiry message
        const paymentWindow = parseInt(process.env.PAYMENT_WINDOW_MINUTES || "15");
        const delayMs = paymentWindow * 60 * 1000;

        await channel.publish(
          "booking_expiry_exchange",
          "booking.expired",
          Buffer.from(JSON.stringify({ booking_id: booking.id })),
          {
            headers: {
              "x-delay": delayMs,
            },
          }
        );

        logger.info(`Scheduled expiry for booking ${booking.id} in ${paymentWindow} minutes`);

        return booking;
      });

      // Send payment request
      await channel.publish(
        "booking_exchange",
        "payment.request",
        Buffer.from(
          JSON.stringify({
            booking_id: result.id,
            amount: result.total_price,
            payment_due_timestamp: result.payment_due_timestamp,
          })
        )
      );
      logger.info(`Sent payment request for booking ${result.id}`);

      // Send pending notification
      await channel.publish(
        "booking_exchange",
        "notification.pending",
        Buffer.from(
          JSON.stringify({
            type: "BOOKING_PENDING_PAYMENT",
            email_to: result.user_email,
            booking_id: result.id,
            details: `Please complete payment of ${result.total_price} before ${result.payment_due_timestamp}`,
          })
        )
      );
      logger.info(`Sent pending notification for booking ${result.id}`);

      callback(null, {
        booking_id: result.id,
        status: result.status,
        payment_due_timestamp: result.payment_due_timestamp.toISOString(),
        total_price: result.total_price,
      });
    } catch (error) {
      logger.error("Error creating booking:", error);
      if (error.code) {
        // If it's already a gRPC error, pass it through
        callback(error);
      } else {
        // Convert other errors to gRPC INTERNAL error
        callback(createGrpcError(grpc.status.INTERNAL, "Error creating booking"));
      }
    }
  },

  // Get Booking Status
  GetBookingStatus: async (call, callback) => {
    try {
      const { booking_id } = call.request;
      logger.info(`Fetching status for booking ${booking_id}`);

      const booking = await prisma.booking.findUnique({
        where: { id: booking_id },
        include: {
          flight: true,
        },
      });

      if (!booking) {
        callback(createGrpcError(grpc.status.NOT_FOUND, `Booking with ID ${booking_id} not found`));
        return;
      }

      logger.info(`Retrieved status for booking ${booking_id}: ${booking.status}`);
      callback(null, {
        booking_id: booking.id,
        status: booking.status,
        flight_id: booking.flight_id,
        user_email: booking.user_email,
        num_seats: booking.num_seats,
        total_price: booking.total_price,
        payment_due_timestamp: booking.payment_due_timestamp.toISOString(),
        flight: {
          ...booking.flight,
          departure_time:
            booking.flight.departure_time instanceof Date
              ? booking.flight.departure_time.toISOString()
              : booking.flight.departure_time,
          arrival_time:
            booking.flight.arrival_time instanceof Date
              ? booking.flight.arrival_time.toISOString()
              : booking.flight.arrival_time,
        },
      });
    } catch (error) {
      logger.error("Error getting booking status:", error);
      if (error.code) {
        callback(error);
      } else {
        callback(createGrpcError(grpc.status.INTERNAL, "Error retrieving booking status"));
      }
    }
  },

  // Get User's Bookings
  GetUserBookings: async (call, callback) => {
    try {
      const { user_email } = call.request;
      logger.info(`Fetching bookings for user ${user_email}`);

      const bookings = await prisma.booking.findMany({
        where: { user_email },
        include: { flight: true },
      });

      const formattedBookings = bookings.map((booking) => ({
        booking_id: booking.id,
        status: booking.status,
        flight_id: booking.flight_id,
        user_email: booking.user_email,
        num_seats: booking.num_seats,
        total_price: booking.total_price,
        payment_due_timestamp: booking.payment_due_timestamp.toISOString(),
        flight: {
          ...booking.flight,
          departure_time:
            booking.flight.departure_time instanceof Date
              ? booking.flight.departure_time.toISOString()
              : booking.flight.departure_time,
          arrival_time:
            booking.flight.arrival_time instanceof Date
              ? booking.flight.arrival_time.toISOString()
              : booking.flight.arrival_time,
        },
      }));

      logger.info(`Found ${bookings.length} bookings for user ${user_email}`);
      callback(null, {
        user_bookings: formattedBookings,
      });
    } catch (error) {
      logger.error("Error fetching user bookings:", error);
      callback(createGrpcError(grpc.status.INTERNAL, "Error fetching user bookings"));
    }
  },
});

// Start the server
const startServer = async () => {
  await setupRabbitMQ();

  server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), (error, port) => {
    if (error) {
      logger.error("Error starting server:", error);
      process.exit(1);
    }
    logger.info(`Server running at http://0.0.0.0:${port}`);
    server.start();
  });
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
  await prisma.$disconnect();
  logger.info("Database connection closed");
  server.forceShutdown();
  logger.info("Server shutdown complete");
};

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// Start the server
startServer();
