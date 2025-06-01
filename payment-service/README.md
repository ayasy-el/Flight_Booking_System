# Payment Service

Mock payment processing service for the Flight Booking System. This service simulates payment processing through manual input.

## Technologies Used

- Node.js
- RabbitMQ (Message Broker)
- readline (for manual input)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
RABBITMQ_URL=amqp://guest:guest@localhost:5672
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

## Interactive Payment Processing

The service runs in interactive mode, allowing manual simulation of payment processing:

1. When running in Docker:

   ```bash
   # Attach to the container
   docker attach flight_booking_system-payment-service-1

   # To detach without stopping: Ctrl+P, Ctrl+Q
   ```

2. For each payment request, you'll see:

   ```
   New payment request received:
   Booking ID: booking_123
   Amount: 1000000
   Due: 2024-01-01T12:00:00Z

   Simulate payment result (s for success, f for failure):
   ```

3. Input options:
   - Type `s` and press Enter for successful payment
   - Type `f` and press Enter for failed payment

## Message Flow

### 1. Receiving Payment Requests

The service listens for payment requests on the `payment_request_q` queue with routing key `payment.request`.

Message Format:

```json
{
  "booking_id": "...",
  "amount": 100.0,
  "payment_due_timestamp": "2024-01-01T12:00:00Z"
}
```

### 2. Processing Payments

When a payment request is received:

1. The service checks if the payment window has expired
2. If not expired, it prompts for manual input
3. Based on the input, it sends a payment status message

### 3. Sending Payment Status

The service sends payment status updates to the `booking_exchange` with routing key `payment.status`.

Message Format:

```json
{
  "booking_id": "...",
  "payment_status": "SUCCESS" | "FAILED",
  "reason": "...",
  "payment_timestamp": "2024-01-01T12:00:00Z"
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
docker build -t flight-booking/payment-service .
```

Run the container:

```bash
# Run with interactive mode
docker run -it --env-file .env flight-booking/payment-service
```

## Notes

- This is a mock service for development and testing purposes
- In production, this should be replaced with a real payment processing service
- The service requires manual input for each payment request
- Payment requests automatically fail if the payment window has expired
- When running in Docker Compose, use `docker attach` to interact with the service
