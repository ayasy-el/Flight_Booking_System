const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const airlines = ["Garuda Indonesia", "Lion Air", "Batik Air", "Citilink", "AirAsia Indonesia"];

const cities = [
  "Jakarta",
  "Surabaya",
  "Denpasar",
  "Medan",
  "Makassar",
  "Yogyakarta",
  "Bandung",
  "Palembang",
];

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomPrice(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) * 100000;
}

function addHours(date, hours) {
  const newDate = new Date(date);
  newDate.setHours(newDate.getHours() + hours);
  return newDate;
}

toUTCDate = (date, hour) => {
  // Membuat date UTC dengan jam tertentu
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0)
  );
};

async function main() {
  // Clear existing data
  await prisma.booking.deleteMany();
  await prisma.flight.deleteMany();

  console.log("Cleared existing data");

  // Create flights for the next 30 days
  const flights = [];
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  for (let day = 0; day < 30; day++) {
    const currentDate = new Date(startDate);
    currentDate.setUTCDate(currentDate.getUTCDate() + day);

    // Create 5 flights per day
    for (let i = 0; i < 5; i++) {
      const origin = getRandomElement(cities);
      let destination;
      do {
        destination = getRandomElement(cities);
      } while (destination === origin);

      const departureTime = toUTCDate(currentDate, 6 + i * 3); // UTC jam 6, 9, 12, 15, 18
      const flight = {
        airline: getRandomElement(airlines),
        origin,
        destination,
        departure_time: departureTime,
        arrival_time: addHours(departureTime, 2), // 2-hour flights
        price_per_seat: getRandomPrice(5, 20), // 500K - 2M IDR
        total_seats: 180,
        available_seats: 180,
      };
      flights.push(flight);
    }
  }

  // Insert flights
  for (const flight of flights) {
    await prisma.flight.create({
      data: flight,
    });
  }

  console.log(`Created ${flights.length} flights`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
