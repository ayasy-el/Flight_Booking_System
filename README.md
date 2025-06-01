# Flight Booking System

A distributed microservices-based flight booking system that handles flight schedules, bookings, payments, and notifications.

## System Architecture

The system consists of the following microservices:

1. **Client Service (API Gateway)**

   - REST API gateway for all user interactions
   - Built with HapiJS and Prisma ORM
   - Communicates with Booking Service via gRPC

2. **Booking Service**

   - Core business logic service
   - Handles flight schedules, bookings, and seat inventory
   - Built with Node.js and gRPC
   - Publishes events to RabbitMQ

3. **Payment Service**

   - Mock payment processing service
   - Built with Node.js
   - Consumes and publishes events via RabbitMQ
   - Interactive CLI for payment simulation

4. **Notification Service**
   - Handles email notifications
   - Built with Node.js
   - Sends emails via Mailpit
   - Consumes events from RabbitMQ

## Prerequisites

- Docker and Docker Compose
- Node.js (v18 or later)
- PostgreSQL (handled by Docker)
- RabbitMQ (handled by Docker)
- Mailpit (handled by Docker)

## Setup Instructions

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd flight-booking-system
   ```

2. Create `.env` files for each service (see individual service READMEs for details)

3. Start all services using Docker Compose:

   ```bash
   docker-compose up -d
   ```

4. Initialize the database (first time only):
   ```bash
   cd client-service
   npx prisma migrate deploy
   npx prisma db seed
   ```

## Service Ports and Access

- Client Service (API Gateway): http://localhost:3000
- RabbitMQ Management UI: http://localhost:15672
  - Username: guest
  - Password: guest
- Mailpit Web UI: http://localhost:8025
- PostgreSQL: localhost:5432
- Booking Service gRPC: localhost:50051

## Logging System

Each service implements comprehensive logging using Winston:

### Log Levels

- ERROR: For errors that need immediate attention
- WARN: For warning conditions
- INFO: For general operational information
- DEBUG: For detailed debugging information

### Log Files

Each service maintains three types of log files:

1. Main Log (`<service>-service.log`):

   - All log levels
   - General application events
   - Maximum size: 5MB
   - Maximum files: 5 (rotation)

2. Error Log (`<service>-service-error.log`):

   - Only ERROR level logs
   - Critical issues and errors
   - Maximum size: 5MB
   - Maximum files: 5 (rotation)

3. Exception Log (`<service>-service-exceptions.log`):
   - Uncaught exceptions
   - Unhandled rejections
   - Maximum size: 5MB
   - Maximum files: 5 (rotation)

### Accessing Logs

Logs are stored in Docker volumes for persistence:

```bash
# View logs for a specific service
docker exec <container_name> cat /app/logs/<service>-service.log

# Example for client service
docker exec flight_booking_system-client-service-1 cat /app/logs/client-service.log

# Follow logs in real-time
docker exec <container_name> tail -f /app/logs/<service>-service.log
```

### Log Format

All logs follow this format:

```
TIMESTAMP [LEVEL] Message
[Stack trace if available]
```

### Environment Variables

Set logging level using `LOG_LEVEL` environment variable:

```yaml
environment:
  LOG_LEVEL: info # debug, info, warn, or error
```

## Using the System

1. **Search for Flights**

   ```bash
   curl "http://localhost:3000/schedules?origin=Jakarta&destination=Surabaya"
   ```

2. **Create a Booking**

   ```bash
   curl -X POST http://localhost:3000/bookings \
     -H "Content-Type: application/json" \
     -d '{
       "flight_id": "your_flight_id",
       "user_email": "john@example.com",
       "num_seats": 1
     }'
   ```

3. **Process Payment**

   After creating a booking, you need to simulate the payment. The payment service runs in interactive mode:

   ```bash
   # Attach to the payment service container
   docker attach flight_booking_system-payment-service-1

   # You will see payment requests appear here
   # For each request, type:
   # 's' for successful payment
   # 'f' for failed payment
   ```

   Note: To detach from the container without stopping it, press `Ctrl+P` followed by `Ctrl+Q`

4. **Check Booking Status**

   ```bash
   curl "http://localhost:3000/bookings/your_booking_id"
   ```

5. **View Email Notifications**
   - Open http://localhost:8025 in your browser
   - All email notifications will appear here

## Message Flow

1. **Booking Creation**:

   - Client -> Booking Service (gRPC)
   - Booking Service -> RabbitMQ (payment.request)
   - Booking Service -> RabbitMQ (notification.pending)

2. **Payment Processing**:

   - Payment Service <- RabbitMQ (payment.request)
   - Payment Service -> RabbitMQ (payment.status)

3. **Booking Status Update**:

   - Booking Service <- RabbitMQ (payment.status)
   - Booking Service -> RabbitMQ (notification.success/failed)

4. **Notifications**:
   - Notification Service <- RabbitMQ (notification.\*)
   - Notification Service -> Mailpit (SMTP)

## Development

Each service has its own README with specific setup instructions and development guidelines. Please refer to:

- [Client Service README](./client-service/README.md)
- [Booking Service README](./booking-service/README.md)
- [Payment Service README](./payment-service/README.md)
- [Notification Service README](./notification-service/README.md)

## Testing

Each service contains its own test suite. To run tests for all services:

```bash
# Run from project root
docker-compose -f docker-compose.test.yml up --build
```

## Troubleshooting

1. **Payment Service Not Interactive**

   - Make sure you're using `docker-compose up -d` to start services
   - Use `docker attach` to connect to the payment service
   - Use `Ctrl+P, Ctrl+Q` to detach without stopping the service

2. **Missing Notifications**

   - Check Mailpit web interface at http://localhost:8025
   - Verify RabbitMQ connections in management UI
   - Check notification service logs for errors

3. **Database Issues**

   - Check PostgreSQL connection at localhost:5432
   - Run migrations: `npx prisma migrate deploy`
   - Reset database if needed: `npx prisma migrate reset`

4. **Logging Issues**
   - Verify log volumes are created: `docker volume ls`
   - Check container permissions: `docker exec -it <container> ls -la /app/logs`
   - Ensure LOG_LEVEL environment variable is set correctly

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
