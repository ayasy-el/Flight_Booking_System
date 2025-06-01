# Booking Service

Core business logic service for the Flight Booking System. Handles flight schedules, bookings, and seat inventory management.

## Technologies Used

- Node.js
- gRPC (Communication with Client Service)
- RabbitMQ (Message Broker)
- In-memory storage (Maps - replace with real database in production)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flight_booking"
RABBITMQ_URL=amqp://guest:guest@localhost:5672
PAYMENT_WINDOW_MINUTES=15
```

## Setup Instructions

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the service:
   ```bash
   npm start
   ```

## gRPC Service Methods

### 1. SearchFlights

Searches for available flights based on criteria.

Request:

```protobuf
message SearchFlightsRequest {
  string origin = 1;
  string destination = 2;
  string date = 3;
  int32 limit = 4;
  int32 page = 5;
}
```

Response:

```protobuf
message SearchFlightsResponse {
  repeated Flight flights = 1;
  int32 total = 2;
  int32 page = 3;
  int32 limit = 4;
  int32 total_pages = 5;
}
```

### 2. CreateBooking

Creates a new booking and initiates the payment process.

Request:

```protobuf
message CreateBookingRequest {
  string flight_id = 1;
  PassengerDetails passenger_details = 2;
  int32 num_seats = 3;
}
```

Response:

```protobuf
message CreateBookingResponse {
  string booking_id = 1;
  string status = 2;
  string payment_due_timestamp = 3;
  double total_price = 4;
}
```

### 3. GetBookingStatus

Retrieves the current status of a booking.

Request:

```protobuf
message GetBookingStatusRequest {
  string booking_id = 1;
}
```

Response:

```protobuf
message GetBookingStatusResponse {
  string booking_id = 1;
  string status = 2;
  string flight_id = 3;
  string user_email = 4;
  int32 num_seats = 5;
  double total_price = 6;
  string payment_due_timestamp = 7;
  repeated PassengerDetails passengers = 8;
  Flight flight = 9;
}
```

## RabbitMQ Message Flow

### Exchanges

- `booking_exchange` (type: direct)

### Queues and Routing Keys

1. Payment Request

   - Queue: `payment_request_q`
   - Routing Key: `payment.request`
   - Message Format:
     ```json
     {
       "booking_id": "...",
       "amount": 100.0,
       "payment_due_timestamp": "2024-01-01T12:00:00Z"
     }
     ```

2. Payment Status

   - Queue: `payment_status_q`
   - Routing Key: `payment.status`
   - Message Format:
     ```json
     {
       "booking_id": "...",
       "payment_status": "SUCCESS" | "FAILED",
       "reason": "...",
       "payment_timestamp": "2024-01-01T12:00:00Z"
     }
     ```

3. Notifications
   - Queue: `notification_q`
   - Routing Keys:
     - `notification.pending`
     - `notification.success`
     - `notification.failed`
     - `notification.expired`
   - Message Format:
     ```json
     {
       "type": "BOOKING_PENDING_PAYMENT" | "BOOKING_CONFIRMED" | "BOOKING_PAYMENT_FAILED" | "BOOKING_EXPIRED",
       "email_to": "user@example.com",
       "booking_id": "...",
       "details": "..."
     }
     ```

## Development

1. Run in development mode with auto-reload:

   ```bash
   npm run dev
   ```

2. Run tests:
   ```bash
   npm test
   ```

## Docker

Build the image:

```bash
docker build -t flight-booking/booking-service .
```

Run the container:

```bash
docker run -p 50051:50051 --env-file .env flight-booking/booking-service
```

## Notes

- Currently using in-memory storage with Maps. In production, replace with a proper database.
- The service includes a cron job to handle expired bookings.
- All communication with other services is done through RabbitMQ, except for the Client Service which uses gRPC.
- The service automatically adds some mock flights on startup for testing purposes. Remove this in production.
