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
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672"
    );
    channel = await connection.createChannel();

    // Declare exchange
    await channel.assertExchange("booking_exchange", "direct", { durable: true });

    // Declare queues
    await channel.assertQueue("payment_request_q", { durable: true });
    await channel.assertQueue("payment_status_q", { durable: true });
    await channel.assertQueue("notification_q", { durable: true });

    // Bind queues to exchange
    await channel.bindQueue("payment_request_q", "booking_exchange", "payment.request");
    await channel.bindQueue("payment_status_q", "booking_exchange", "payment.status");
    await channel.bindQueue("notification_q", "booking_exchange", "notification.pending");
    await channel.bindQueue("notification_q", "booking_exchange", "notification.success");
    await channel.bindQueue("notification_q", "booking_exchange", "notification.failed");
    await channel.bindQueue("notification_q", "booking_exchange", "notification.expired");

    // Setup payment status consumer
    await channel.consume("payment_status_q", handlePaymentStatus, { noAck: true });

    logger.info("RabbitMQ setup completed");
  } catch (error) {
    logger.error("Error setting up RabbitMQ:", error);
    process.exit(1);
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
      if (origin) where.origin = origin;
      if (destination) where.destination = destination;
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
        price_per_seat: parseFloat(flight.price_per_seat.toString()), // Convert Decimal to float
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
      const { flight_id, passenger_details, num_seats } = call.request;
      logger.info(`Creating booking for flight ${flight_id} - ${num_seats} seats`);

      // Use transaction to ensure data consistency
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
            user_email: passenger_details.email,
            num_seats,
            total_price,
            payment_due_timestamp,
            passengers: {
              create: {
                name: passenger_details.name,
                email: passenger_details.email,
                phone_number: passenger_details.phone_number,
              },
            },
          },
          include: {
            passengers: true,
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

        logger.info(`Created booking ${booking.id} for flight ${flight_id}`);
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
          passengers: true,
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
        passengers: booking.passengers,
        flight: booking.flight,
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
