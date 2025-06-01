const winston = require("winston");
const path = require("path");

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message}${stack ? "\n" + stack : ""}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  transports: [
    // Console transport for all logs
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level}] ${message}${stack ? "\n" + stack : ""}`;
        })
      ),
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join("logs", "booking-service.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Separate file for error logs
    new winston.transports.File({
      filename: path.join("logs", "booking-service-error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  // Explicitly handle errors in all transports
  exceptionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, message, stack }) => {
          return `${timestamp} [ERROR] ${message}${stack ? "\n" + stack : ""}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: path.join("logs", "booking-service-exceptions.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  // Prevent winston from exiting on uncaught exceptions
  exitOnError: false,
});

// Handle unhandled rejections
process.on("unhandledRejection", (error) => {
  // Log to both file and console
  logger.error("Unhandled Rejection:", error);
  console.error("Unhandled Rejection:", error);
});

module.exports = logger;
