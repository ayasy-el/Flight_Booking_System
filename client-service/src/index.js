const Hapi = require("@hapi/hapi");
const Joi = require("@hapi/joi");
const { PrismaClient } = require("@prisma/client");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const logger = require("./utils/logger");
require("dotenv").config();

const prisma = new PrismaClient();

// Error mapping for gRPC status codes to HTTP status codes
const errorMap = {
  [grpc.status.INVALID_ARGUMENT]: 400,
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.ALREADY_EXISTS]: 409,
  [grpc.status.FAILED_PRECONDITION]: 412,
  [grpc.status.RESOURCE_EXHAUSTED]: 429,
  [grpc.status.INTERNAL]: 500,
  [grpc.status.UNAVAILABLE]: 503,
};

// Convert gRPC error to HTTP error response
const handleGrpcError = (error) => {
  const statusCode = errorMap[error.code] || 500;
  const errorMessage = error.details || error.message;

  logger.error(`gRPC error: [${error.code}] ${errorMessage}`);

  return {
    statusCode,
    error: grpc.status[error.code] || "Internal Server Error",
    message: errorMessage,
  };
};

// Promisify gRPC calls
const promisifyGrpcCall = (method, request) => {
  return new Promise((resolve, reject) => {
    method(request, (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
};

// Load gRPC proto file
const PROTO_PATH = path.resolve(__dirname, "../proto/booking.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const bookingProto = grpc.loadPackageDefinition(packageDefinition).booking;
const bookingClient = new bookingProto.BookingService(
  process.env.BOOKING_SERVICE_URL || "localhost:50051",
  grpc.credentials.createInsecure()
);

const init = async () => {
  const server = Hapi.server({
    port: process.env.PORT || 3000,
    host: "0.0.0.0",
    routes: {
      cors: {
        origin: ["*"],
        additionalHeaders: ["x-user-email"],
      },
    },
  });

  // Search Flights Route
  server.route({
    method: "GET",
    path: "/schedules",
    options: {
      validate: {
        query: Joi.object({
          origin: Joi.string().optional(),
          destination: Joi.string().optional(),
          date: Joi.string().isoDate().optional(),
          limit: Joi.number().integer().min(1).default(10),
          page: Joi.number().integer().min(1).default(1),
        }),
      },
    },
    handler: async (request, h) => {
      try {
        logger.info(`Searching flights with criteria: ${JSON.stringify(request.query)}`);
        const response = await promisifyGrpcCall(
          bookingClient.SearchFlights.bind(bookingClient),
          request.query
        );
        logger.info(`Found ${response.flights?.length || 0} flights`);
        return response;
      } catch (error) {
        const errorResponse = handleGrpcError(error);
        return h.response(errorResponse).code(errorResponse.statusCode);
      }
    },
  });

  // Create Booking Route
  server.route({
    method: "POST",
    path: "/bookings",
    options: {
      validate: {
        payload: Joi.object({
          flight_id: Joi.string().required(),
          user_email: Joi.string().email().required(),
          num_seats: Joi.number().integer().min(1).required(),
        }),
      },
    },
    handler: async (request, h) => {
      try {
        logger.info(`Creating booking for flight ${request.payload.flight_id}`);
        const response = await promisifyGrpcCall(
          bookingClient.CreateBooking.bind(bookingClient),
          request.payload
        );
        logger.info(`Booking created with ID: ${response.booking_id}`);
        return response;
      } catch (error) {
        const errorResponse = handleGrpcError(error);
        return h.response(errorResponse).code(errorResponse.statusCode);
      }
    },
  });

  // Get User's Bookings
  server.route({
    method: "GET",
    path: "/bookings",
    options: {
      validate: {
        headers: Joi.object({
          "x-user-email": Joi.string().email().required(),
        }).unknown(),
      },
    },
    handler: async (request, h) => {
      try {
        const user_email = request.headers["x-user-email"];
        logger.info(`Fetching bookings for user ${user_email}`);
        const response = await promisifyGrpcCall(
          bookingClient.GetUserBookings.bind(bookingClient),
          { user_email }
        );

        logger.info(`Found ${response.user_bookings?.length || 0} bookings`);
        const formattedBookings = response.user_bookings.map((booking) => ({
          booking_id: booking.booking_id,
          status: booking.status,
          flight: {
            id: booking.flight.id,
            name: booking.flight.airline,
            price: booking.flight.price,
            departure_time: booking.flight.departure_time,
            arrival_time: booking.flight.arrival_time,
            origin: booking.flight.origin,
            destination: booking.flight.destination,
          },
          total_price: booking.total_price,
        }));
        return formattedBookings;
      } catch (error) {
        const errorResponse = handleGrpcError(error);
        return h.response(errorResponse).code(errorResponse.statusCode);
      }
    },
  });

  // Get Booking Status Route
  server.route({
    method: "GET",
    path: "/bookings/{bookingId}",
    options: {
      validate: {
        params: Joi.object({
          bookingId: Joi.string().required(),
        }),
      },
    },
    handler: async (request, h) => {
      try {
        logger.info(`Fetching status for booking ${request.params.bookingId}`);
        const response = await promisifyGrpcCall(
          bookingClient.GetBookingStatus.bind(bookingClient),
          {
            booking_id: request.params.bookingId,
          }
        );
        logger.info(`Retrieved status for booking ${request.params.bookingId}: ${response.status}`);
        return response;
      } catch (error) {
        const errorResponse = handleGrpcError(error);
        return h.response(errorResponse).code(errorResponse.statusCode);
      }
    },
  });

  // Error handling for validation errors
  server.ext("onPreResponse", (request, h) => {
    const response = request.response;

    if (response.isBoom) {
      // Handle validation errors
      if (response.output.statusCode === 400) {
        return h
          .response({
            statusCode: 400,
            error: "Validation Error",
            message: response.output.payload.message,
            details: response.output.payload.validation || response.output.payload.message,
          })
          .code(400);
      }

      // Handle other Boom errors
      return h
        .response({
          statusCode: response.output.statusCode,
          error: response.output.payload.error,
          message: response.output.payload.message,
        })
        .code(response.output.statusCode);
    }

    return h.continue;
  });

  await server.start();
  logger.info(`Server running on ${server.info.uri}`);
};

process.on("unhandledRejection", (err) => {
  logger.error("Unhandled rejection:", err);
  process.exit(1);
});

init();
