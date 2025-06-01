# Client Service (API Gateway)

This service acts as the API gateway for the Flight Booking System, providing REST API endpoints and communicating with the Booking Service via gRPC.

## Technologies Used

- Node.js
- HapiJS (REST API framework)
- Joi (Request validation)
- Prisma (ORM)
- gRPC (Communication with Booking Service)
- PostgreSQL (Database)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flight_booking"
BOOKING_SERVICE_URL="booking-service:50051"
```

## Setup Instructions

1. Install dependencies:

   ```bash
   npm install
   ```

2. Generate Prisma Client:

   ```bash
   npx prisma generate
   ```

3. Run database migrations:

   ```bash
   npx prisma migrate deploy
   ```

4. Start the service:
   ```bash
   npm start
   ```

## API Endpoints

### 1. Search Flights

```http
GET /schedules
```

Query Parameters:

- `origin` (optional): Origin city/airport
- `destination` (optional): Destination city/airport
- `date` (optional): Flight date (ISO format)
- `limit` (optional, default: 10): Number of results per page
- `page` (optional, default: 1): Page number

Response:

```json
{
  "flights": [
    {
      "id": "...",
      "origin": "...",
      "destination": "...",
      "departure_time": "...",
      "arrival_time": "...",
      "price_per_seat": 100.0,
      "total_seats": 100,
      "available_seats": 50
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 10,
  "total_pages": 10
}
```

### 2. Create Booking

```http
POST /bookings
```

Request Body:

```json
{
  "flight_id": "...",
  "passenger_details": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone_number": "+1234567890" // optional
  },
  "num_seats": 1
}
```

Response:

```json
{
  "booking_id": "...",
  "status": "PENDING_PAYMENT",
  "payment_due_timestamp": "2024-01-01T12:00:00Z",
  "total_price": 100.0
}
```

### 3. Get Booking Status

```http
GET /bookings/{bookingId}
```

Response:

```json
{
  "booking_id": "...",
  "status": "PENDING_PAYMENT",
  "flight_id": "...",
  "user_email": "john@example.com",
  "num_seats": 1,
  "total_price": 100.0,
  "payment_due_timestamp": "2024-01-01T12:00:00Z",
  "passengers": [
    {
      "name": "John Doe",
      "email": "john@example.com",
      "phone_number": "+1234567890"
    }
  ],
  "flight": {
    "id": "...",
    "origin": "...",
    "destination": "...",
    "departure_time": "...",
    "arrival_time": "...",
    "price_per_seat": 100.0,
    "total_seats": 100,
    "available_seats": 50
  }
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
docker build -t flight-booking/client-service .
```

Run the container:

```bash
docker run -p 3000:3000 --env-file .env flight-booking/client-service
```

## Database Schema

The service uses the following database schema (via Prisma):

```prisma
model Flight {
  id              String    @id @default(cuid())
  origin          String
  destination     String
  departure_time  DateTime
  arrival_time    DateTime
  price_per_seat  Decimal
  total_seats     Int
  available_seats Int
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt
  bookings        Booking[]
}

model Booking {
  id                    String        @id @default(cuid())
  flight_id             String
  user_email            String
  num_seats             Int
  total_price           Decimal
  status                BookingStatus @default(PENDING_PAYMENT)
  payment_due_timestamp DateTime
  created_at            DateTime      @default(now())
  updated_at            DateTime      @updatedAt
  flight                Flight        @relation(fields: [flight_id], references: [id])
  passengers            Passenger[]
}

model Passenger {
  id           String   @id @default(cuid())
  booking_id   String
  name         String
  email        String?
  phone_number String?
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
  booking      Booking  @relation(fields: [booking_id], references: [id], onDelete: Cascade)
}

enum BookingStatus {
  PENDING_PAYMENT
  CONFIRMED
  FAILED_PAYMENT
  CANCELLED
  EXPIRED
}
```
