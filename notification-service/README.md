# Notification Service

Email notification service for the Flight Booking System. Handles sending email notifications for various booking events.

## Technologies Used

- Node.js
- RabbitMQ (Message Broker)
- Nodemailer (Email sending)
- Mailpit (SMTP server for development)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
RABBITMQ_URL=amqp://guest:guest@localhost:5672
SMTP_HOST=mailpit
SMTP_PORT=1025
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

## Message Flow

The service listens for messages on the `notification_q` queue with the following routing keys:

- `notification.pending`
- `notification.success`
- `notification.failed`
- `notification.expired`

### Message Format

```json
{
  "type": "BOOKING_PENDING_PAYMENT" | "BOOKING_CONFIRMED" | "BOOKING_PAYMENT_FAILED" | "BOOKING_EXPIRED",
  "email_to": "user@example.com",
  "booking_id": "...",
  "details": "..."
}
```

### Email Templates

1. **Pending Payment**

   - Subject: "Flight Booking Payment Required - Booking {id}"
   - Content: Payment instructions and deadline

2. **Booking Confirmed**

   - Subject: "Flight Booking Confirmed - Booking {id}"
   - Content: Booking confirmation details

3. **Payment Failed**

   - Subject: "Flight Booking Payment Failed - Booking {id}"
   - Content: Payment failure reason and retry instructions

4. **Booking Expired**
   - Subject: "Flight Booking Expired - Booking {id}"
   - Content: Expiration notice and rebooking instructions

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
docker build -t flight-booking/notification-service .
```

Run the container:

```bash
docker run --env-file .env flight-booking/notification-service
```

## Email Testing

The service uses Mailpit for email testing in development:

- SMTP Server: mailpit:1025
- Web Interface: http://localhost:8025

All sent emails can be viewed in the Mailpit web interface.

## Notes

- Uses Mailpit as a mock SMTP server for development
- In production, replace Mailpit with a real SMTP server
- Email templates are currently simple text-based messages
- Consider using HTML templates for better email presentation in production
